/**
 * 模板编译与打包工具
 *
* 模块结构：
 * 1. 递归目录复制工具（copyDir）
 * 2. 路由文件处理及入口文件生成
 *    - 路由检测（checkUserRoutesExist）
 *    - 入口文件生成（generateServerEntry）
 *    - 依赖管理（checkExpressDependency/getExpressVersion）
 * 3. 编译模板所有文件（compile）
 * 4. 批量编译主流程（compileAllTemplates）
 * 5.导出接口与执行编译
 *
 * 核心功能：
 * - 完整的模板编译流水线：模板替换→包含处理→变量替换→文件输出
 * - 智能路由检测与入口生成：自动创建可运行的服务端环境
 * - 资源打包优化：确保路由文件在静态资源前生成
 * - 生产环境就绪：自动生成Express服务器和依赖配置
 *
 * 特殊机制：
 * - 编译模式标识：控制包含文件的收集逻辑
 * - 路由功能检测：扫描用户功能文件中的setupRoutes函数
 * - 模块缓存清理：确保路由加载时使用最新代码
 * - 语义化版本控制：自动获取Express版本号
 */
// 1
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const {
	getAvailableTemplates, validateTemplateFile, renderTemplate, processIncludes, processVariables, setCompilationMode,
	getIncludedFiles, loadUserFeatures, findEntryFile, staticDir, customizeDir, defaultPort
} = require('./services/templateService');
const outPutDir = 'dist'; // 打包输出目录
let cachedPages = [];	  // 缓存模板列表

// ==================== 1.递归目录复制工具 ====================
/**
 * 目录结构克隆工具（含错误抑制）
 * @param {string} src - 源目录路径
 * @param {string} destDir - 目标目录路径
 *
 * 特性：
 * - 自动创建目标目录结构
 * - 跳过不存在的源目录（不报错）
 * - 保留子目录结构递归复制
 */
async function copyDir(src, destDir) {
	try {
		await fsPromises.mkdir(destDir, { recursive: true });
		const entries = await fsPromises.readdir(src, { withFileTypes: true });

		for (const entry of entries) {
			const srcPath = path.join(src, entry.name), destPath = path.join(destDir, entry.name);
			if (entry.isDirectory()) await copyDir(srcPath, destPath);
			else await fsPromises.copyFile(srcPath, destPath);
		}
	} catch (error) {
		if (error.code !== 'ENOENT') console.error(`❌ 复制目录出错: ${src} -> ${destDir}`, error.message);
	}
}

// ==================== 2.路由文件处理及入口文件生成 ====================

/**
 * 检测用户是否定义路由功能
 * @returns {Promise<boolean>} 是否存在有效路由
 */
async function checkUserRoutesExist() {
	try {
		const featuresDir = path.join(process.cwd(), customizeDir);
		await fsPromises.access(featuresDir);

		const files = await fsPromises.readdir(featuresDir);
		for (const file of files.filter(f => f.endsWith('.js'))) {
			try {
				const content = await fsPromises.readFile(path.join(featuresDir, file), 'utf8');
				if (content.includes('setupRoutes:')) return true;
			} catch { }
		}

		return false;
	} catch {
		return false;
	}
}

/**
 * 生成服务端入口文件
 * @param {string} outputDir - 输出目录路径
 * @returns {Promise<boolean>} 是否成功生成
 */
async function generateServerEntry(outputDir) {
	try {
		// 安全依赖检查
		const expressInstalled = checkExpressDependency();
		if (!expressInstalled) {
			console.warn('⚠️ 未检测到Express依赖，跳过服务端入口生成');
			return false;
		}
		const entryFile = await findEntryFile(cachedPages), // 动态获取入口
			// 入口文件内容
			serverContent = `
			const express = require('express');
			const path = require('path');
			const fs = require('fs');
			const app = express();

			app.get('/', (req, res) => {res.redirect('/${entryFile}');});
			const port = process.env.PORT || ${defaultPort};

			// 存储所有路由信息
			const allRoutes = [];

			// 创建包装函数追踪路由注册
			function wrapAppMethods(app) {
			    const originalMethods = {};
			    const methodsToWrap = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all'];

			    methodsToWrap.forEach(method => {
			        originalMethods[method] = app[method].bind(app);
			        app[method] = function(path, ...handlers) {
			            // 记录路由信息
			            allRoutes.push({
			                method: method.toUpperCase(),
			                path: path
			            });

			            // 调用原始方法
			            return originalMethods[method](path, ...handlers);
			        };
			    });

			    return app;
			}

			// 包装app方法以追踪路由
			wrapAppMethods(app);

			// 静态资源服务
			app.use(express.static(__dirname));

			// 用户路由加载器
			const loadUserRoutes = () => {
			    const featuresDir = path.join(__dirname, '${customizeDir}');

			    // 检查目录是否存在
			    if (!fs.existsSync(featuresDir)) {
			        console.log(\`   ℹ️ \${featuresDir}目录不存在，跳过路由加载\`);
			        return;
			    }

			    const routeFiles = fs.readdirSync(featuresDir)
			        .filter(file => file.endsWith('.js'));

			    routeFiles.forEach(file => {
			        try {
			            const modulePath = path.join(featuresDir, file);
			            delete require.cache[require.resolve(modulePath)];

			            const feature = require(modulePath);
			            if (typeof feature.setupRoutes === 'function') {
			                feature.setupRoutes(app);
			                console.log(\`   ✅ 路由加载文件: \${file}\`);
			            }
			        } catch (e) {
			            console.error(\`   ❌ 路由加载失败: \${file}\`, e.message);
			        }
			    });
			};

			// 打印路由信息
			const printRoutes = () => {
			    if (allRoutes.length > 0) {
			        console.log('   🗺️ 注册路由:');
			        allRoutes.forEach(route => {
			            console.log(\`      \${route.method.padEnd(6)} \${route.path}\`);
			        });
			    } else  console.log('   ℹ️ 未找到任何路由');
			};

			// 启动服务器
			app.listen(port, () => {
			    console.log(\`\\n🚀 服务已启动: http://localhost:\${port}\`);
			    console.log('📡 路由监控:');

			    // 加载路由
			    loadUserRoutes();

			    // 打印路由信息
			    printRoutes();
			});
        `.trim(),

			// 创建package.json
			pkgContent = JSON.stringify({
				name: "dist-server", version: "1.0.0", main: "server.js", dependencies: { express: getExpressVersion() }
			}, null, 2);

		// 原子写入操作
		await Promise.all([
			fsPromises.writeFile(path.join(outputDir, 'server.js'), serverContent),
			fsPromises.writeFile(path.join(outputDir, 'package.json'), pkgContent)
		]);

		return true;
	} catch (error) {
		console.error('❌ 服务端入口生成失败:', error.message);
		return false;
	}
}

/**
 * 检查Express依赖是否存在
 * @returns {boolean} 是否已安装
 */
function checkExpressDependency() {
	try {
		require.resolve('express');
		return true;
	} catch {
		return false;
	}
}

/**
 * 获取当前Express版本
 * @returns {string} Express版本号
 */
function getExpressVersion() {
	try {
		const version = require('express/package.json').version;
		return `^${version}`; // 保持语义化版本
	} catch {
		return '^4.18.0'; // 安全回退
	}
}

// ==================== 3.编译模板文件 ====================
/**
 * 完整的模板编译处理链
 * @param {string} cachedPages - 所有待编译文件
 *
 * 处理阶段：
 * 1. 展平编译(模板继承,包含指令解析,变量占位符替换)
 * 2. 获取所有包含文件并跳过
 * 3. 文件输出
 */
async function compile(cachedPages) {
	for (const templateFile of cachedPages) {
		try {
			// 展平编译
			let rendered = await renderTemplate(templateFile);
			rendered = await processIncludes(rendered, templateFile);
			rendered = processVariables(rendered, { currentUrl: `/${templateFile}`, query: {} });

			const includedFiles = getIncludedFiles();// 获取所有包含文件
			if (includedFiles.has(templateFile)) continue;// 跳过被包含的文件

			// 输出文件
			const outputPath = path.join(process.cwd(), path.join(outPutDir, templateFile));
			await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
			await fsPromises.writeFile(outputPath, rendered);
			console.log(`✅ ${templateFile} ->已编译: ${path.join(outPutDir, templateFile)}`);
		} catch (error) {
			console.error(`❌ 编译 ${templateFile} 时出错: ${error.message}`);
		}
	}
}

// ==================== 4.批量编译主流程 ====================
/**
 * 全量模板编译与打包入口
 *
 * 核心流程：
 * 1. 初始化编译环境（模式标识->缓存清理->验证模板->获取编译文件）
 * 2. 预加载用户自定义变量
 * 3. 创建打包目录
 * 4. 异步编译所有模板文件
 * 5. 路由检测,入口文件动态生成,静态资源打包,完成后相关提示
 * 6. 恢复非编译模式
 *
 * 特殊处理：
 * - 通过编译模式切换包含文件收集行为
 * - 自动过滤片段文件避免重复输出
 */
async function compileAllTemplates() {
	try {
		// 1.设置编译模式并清空包含文件记录
		setCompilationMode(true), cachedPages = await getAvailableTemplates();

		for (const file of cachedPages) await validateTemplateFile(file); // 模板验证
		// 2.加载用户自定义功能（编译模式）
		await loadUserFeatures(null, true), console.log(`ℹ️ 变量已从${customizeDir}目录加载`);

		// 3.创建打包目录
		await fsPromises.rm(outPutDir, { recursive: true, force: true });
		await fsPromises.mkdir(outPutDir, { recursive: true }), console.log(`📁 已创建输出目录: ${outPutDir}`);

		// 4.异步编译所有文件
		await compile(cachedPages), console.log(`\n🎉 编译文件完成!`);
		// 5. 路由检测,判断入口文件是否生成,静态资源复制,完成后相关提示
		const hasUserRoutes = await checkUserRoutesExist();
		let serverGenerated = false;

		if (hasUserRoutes) serverGenerated = await generateServerEntry(outPutDir);
		await copyDir(staticDir, path.join(outPutDir, staticDir));
		await copyDir(customizeDir, path.join(outPutDir, customizeDir)), console.log('✅ 资源打包完成');
		if (serverGenerated) {
			console.log('\n🚀 检测到自定义路由，已创建服务端入口文件'), console.log('👉 启动服务器命令:');
			console.log('   cd dist && npm install && node server.js');
		}

		// 6.恢复非编译模式
		setCompilationMode(false);
	} catch (error) {
		console.error('❌ 编译流程出错:', error.message), setCompilationMode(false);
	}
}

// ==================== 5.导出接口与执行编译 ====================
module.exports = { compileAllTemplates };
if (require.main === module) compileAllTemplates();