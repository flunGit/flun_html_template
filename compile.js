/**
 * 模板编译与打包工具
 *
 * 模块结构：
 * 1. 递归目录复制工具（copyDir）
 * 2. 路由文件处理及入口文件生成
 *    - 路由检测（checkUserRoutesExist）
 *    - 入口文件生成（generateServerEntry）
 *    - 依赖管理（mergeDependencies → 返回完整 package.json）
 * 3. 编译模板所有文件（compile）
 * 4. 批量编译主流程（compileAllTemplates）
 * 5. 导出接口与执行编译
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
 * - Express版本管理：优先使用模板依赖，默认^5.2.1
 */
import {
	path, fsPromises, CWD, getAvailableTemplates, validateTemplateFile, renderTemplate, processIncludes, processVariables,
	setCompilationMode, getIncludedFiles, loadUserFeatures, findEntryFile, templatesDir, staticDir, customizeDir, defaultPort
} from './services/templateService.js';
import PK from './package.json' assert { type: 'json' };
import util from 'util';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

let cachedPages = []; // 缓存模板列表
const execPromise = util.promisify(exec),

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
	copyDir = async (src, destDir) => {
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
	},

	// ==================== 2.路由文件处理及入口文件生成 ====================

	/**
	 * 检测用户是否定义路由功能(兼容默认导出与具名导出)
	 * @returns {Promise<boolean>} 是否存在有效路由
	 */
	checkUserRoutesExist = async () => {
		try {
			const featuresDir = path.join(CWD, customizeDir);
			await fsPromises.access(featuresDir);
			const files = (await fsPromises.readdir(featuresDir)).filter(f => f.endsWith('.js'));
			for (const file of files) {
				try {
					const mod = await import(path.join(featuresDir, file)), feature = mod.default?.setupRoutes ? mod.default : mod;
					if (typeof feature.setupRoutes === 'function') return true;
				} catch { }
			}
			return false;
		} catch {
			return false;
		}
	},

	/**
	 * 合并用户项目依赖与模板工具依赖,生成完整的 package.json 内容
	 * @param {boolean} hasUserRoutes - 是否存在用户自定义路由
	 * @returns {Promise<string>} 格式化后的 package.json 字符串
	 */
	mergeDependencies = async hasUserRoutes => {
		let basePkg = {}, userDeps = {}, mergedDeps = {};
		const userPkgPath = path.join(CWD, 'package.json');
		try {
			const userPkgRaw = await fsPromises.readFile(userPkgPath, 'utf8'), userPkg = JSON.parse(userPkgRaw);
			basePkg.author = userPkg.author || '', basePkg.license = userPkg.license || 'ISC';
			userDeps = userPkg.dependencies || {};
		} catch (err) { }

		if (hasUserRoutes) {
			const templateDeps = PK.dependencies || {}, excludeList = ['chokidar', 'socket.io', 'flun-html-template'];
			mergedDeps = { ...templateDeps, ...userDeps };
			for (const pkg of excludeList) delete mergedDeps[pkg];
		}
		if (!mergedDeps.express) mergedDeps.express = '^5.2.1';

		const finalPkg = {
			name: 'dist-server', version: '1.0.0',
			...basePkg,
			type: 'module', main: 'server.js',
			scripts: { dev: 'node server.js' },
			dependencies: mergedDeps,
			overrides: { 'fast-xml-parser': '^5.3.4' }
		};
		return JSON.stringify(finalPkg, null, 2);
	},

	/**
	 * 在目标目录中执行 npm install
	 * @param {string} targetDir - 目标目录
	 */
	installDependencies = async targetDir => {
		console.log('📦 正在安装项目依赖，请稍候...');
		try {
			const { stdout, stderr } = await execPromise('npm install', { cwd: targetDir });
			if (stdout) console.log(stdout);
			if (stderr) console.error(stderr);
			console.log('✅ 依赖安装完成');
		} catch (error) {
			console.error('❌ 依赖安装失败:', error.message);
			console.log('💡 请手动进入目标目录执行 npm install');
		}
	},

	/**
	 * 生成服务端入口文件内容（ESM 格式）
	 * @param {boolean} hasUserRoutes - 是否存在用户自定义路由
	 * @param {string} entryFile - 入口文件名（如 index.html）
	 * @returns {Promise<string>} server.js 文件内容
	 */
	generateServerEntry = async (hasUserRoutes, entryFile) => {
		const imports = `import express from 'express';
			import path from 'path';
			import { fileURLToPath } from 'url';
			const __filename = fileURLToPath(import.meta.url), __dirname = path.dirname(__filename),
			app = express(),port = process.env.PORT || ${defaultPort}`,
			corsAndSecurity = `
			app.use((req, res, next) => {
			    res.setHeader('Access-Control-Allow-Origin', '*');
			    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
			    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-CSRF-Token');
			    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
			    res.setHeader('Access-Control-Max-Age', '86400');
			    res.setHeader('X-Content-Type-Options', 'nosniff');
			    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
			    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
			    if (req.method === 'OPTIONS') {
			        res.setHeader('Content-Length', '0');
			        return res.status(204).end();
			    }
			    next();
			}),	app.set('trust proxy', false);`,
			staticMiddleware = `app.use('/static', express.static(path.join(__dirname, '${staticDir}')));
			app.use(express.static(path.join(__dirname, '${templatesDir}')));`,
			defaultRootRoute = `app.get('/', (req, res) => res.redirect('/${entryFile}'));`;

		// ----- 有用户路由时的动态加载服务器 -----
		if (hasUserRoutes) {
			return `
 			import fs from 'fs';
 			${imports}, allRoutes = [];

 			// 拦截 app 方法,收集路由
 			const wrapAppMethods = (app) => {
 			    const methodsToWrap = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all'], originals = {};
 			    methodsToWrap.forEach(method => {
 			        originals[method] = app[method].bind(app);
 			        app[method] = function(routePath, ...handlers) {
 			            allRoutes.push({ method: method.toUpperCase(), path: routePath });
 			            return originals[method](routePath, ...handlers);
 			        };
 			    });
 			},
 			// 打印已注册路由
 			printRoutes = () => {
 			    if (allRoutes.length) {
 			        console.log('   🗺️ 注册路由:');
 			        allRoutes.forEach(r => console.log(\`      \${r.method.padEnd(6)} \${r.path}\`));
 			    } else console.log('   ℹ️ 未找到任何路由');
 			},
 			// 动态加载用户自定义路由
 			loadUserRoutes = async () => {
 			    const featuresDir = path.join(__dirname, '${customizeDir}');
 			    if (!fs.existsSync(featuresDir)) return console.log(\`   ℹ️ \${featuresDir}目录不存在，跳过路由加载\`);

 			    const routeFiles = fs.readdirSync(featuresDir).filter(file => file.endsWith('.js')).sort();
 			    for (const file of routeFiles) {
 			        try {
 			            // 使用带时间戳的查询参数避免模块缓存,确保每次获取最新内容
 			            const modulePath = path.join(featuresDir, file), feature = await import(modulePath + '?update=' + Date.now());
 			            if (typeof feature.default?.setupRoutes === 'function') {
 			                feature.default.setupRoutes(app);
 			                console.log(\`   ✅ 路由加载文件: \${file}\`);
 			            } else if (typeof feature.setupRoutes === 'function') {
 			                feature.setupRoutes(app);
 			                console.log(\`   ✅ 路由加载文件: \${file}\`);
 			            }
 			        } catch (e) {
 			            console.error(\`   ❌ 路由加载失败: \${file}\`, e.message);
 			        }
 			    }
 			};

 			wrapAppMethods(app);
 			${corsAndSecurity}

 			// 启动流程：先加载路由,再注册静态资源与默认路由
 			const start = async () => {
 			    await loadUserRoutes();
 			    ${staticMiddleware}
 			    if (!allRoutes.some(r => r.method === 'GET' && r.path === '/')) ${defaultRootRoute}
 			    app.listen(port, () => {
 			        console.log(\`\\n🚀 服务已启动: http://localhost:\${port}\`);
 			        console.log('📡 路由监控:');
 			        printRoutes();
 			    });
 			};
 		start();`.trim();
		}

		// ----- 无用户路由时的纯静态服务器 -----
		return `
		${imports};

		${corsAndSecurity}
		${staticMiddleware}
		${defaultRootRoute}
		app.listen(port, () => {
		    console.log(\`\\n🚀 静态服务器已启动: http://localhost:\${port}\`);
		    console.log('📁 当前仅提供静态文件服务（未检测到用户路由）');
		});`.trim();
	},

	// ==================== 3.编译模板文件 ====================
	/**
	 * @param {string[]} cachedPages - 所有待编译文件（相对于 templatesDir 的路径）
	 * @param {string} outputDir - 输出根目录（例如 'dist'）
	 *
	 * 处理阶段：
	 * 1. 展平编译(模板继承,包含指令解析,变量占位符替换)
	 * 2. 获取所有包含文件并跳过
	 * 3. 文件输出到 outputDir/templatesDir/ 下，保持原相对路径结构
	 */
	compile = async (cachedPages, outputDir) => {
		for (const templateFile of cachedPages) {
			try {
				let rendered = await renderTemplate(templateFile);
				rendered = await processIncludes(rendered, templateFile);
				rendered = processVariables(rendered, { currentUrl: `/${templateFile}`, query: {} });

				const includedFiles = getIncludedFiles(); // 获取所有包含文件
				if (includedFiles.has(templateFile)) continue; // 跳过被包含的文件

				const outputPath = path.join(CWD, outputDir, templatesDir, templateFile);
				await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
				await fsPromises.writeFile(outputPath, rendered);
				console.log(`✅ ${templateFile} ->已编译: ${path.join(outputDir, templatesDir, templateFile)}`);
			} catch (error) {
				console.error(`❌ 编译 ${templateFile} 时出错: ${error.message}`);
			}
		}
	};

// ==================== 4.批量编译主流程 ====================
/**
 * 全量模板编译与打包入口
 *
 * @param {string|Object} [options] - 配置项，可以是字符串（输出目录）或对象（支持 outputDir 字段）
 * @param {string} [options.outputDir='dist'] - 自定义打包输出目录
 *
 * 核心流程：
 * 1. 初始化编译环境（模式标识->缓存清理->验证模板->获取编译文件）
 * 2. 预加载用户自定义变量
 * 3. 创建打包目录,异步编译所有模板文件
 * 4. 路由检测，根据有无路由准备不同的依赖对象, 生成入口文件内容、原子写入文件
 * 5. 复制资源、自动安装依赖、恢复非编译模式
 *
 * 特殊处理：
 * - 通过编译模式切换包含文件收集行为
 * - 自动过滤片段文件避免重复输出
 * - 有路由时合并用户依赖，无路由时仅包含 express
 * - 自动安装依赖确保运行环境完整
 */
const compileAllTemplates = async (options = {}) => {
	if (typeof options === 'string') options = { outputDir: options };
	const outputDir = options.outputDir || 'dist';

	try {
		// 1.设置编译模式并清空包含文件记录
		setCompilationMode(true), cachedPages = await getAvailableTemplates();
		for (const file of cachedPages) await validateTemplateFile(file); // 模板验证

		// 2.加载用户自定义功能（编译模式）
		await loadUserFeatures(null, true), console.log(`ℹ️ 变量已从${customizeDir}目录加载`);

		// 3.创建打包目录
		await fsPromises.rm(outputDir, { recursive: true, force: true });
		await fsPromises.mkdir(outputDir, { recursive: true }), console.log(`📁 已创建输出目录: ${outputDir}`);
		await compile(cachedPages, outputDir), console.log(`\n🎉 编译文件完成!`);

		// 4. 检测是否存在用户路由,生成package.json内容,获取入口文件生成 server.js 内容，并原子写入磁盘
		const hasUserRoutes = await checkUserRoutesExist(), pkgContent = await mergeDependencies(hasUserRoutes),
			entryFile = await findEntryFile(cachedPages), serverContent = await generateServerEntry(hasUserRoutes, entryFile);

		await Promise.all([
			fsPromises.writeFile(path.join(outputDir, 'server.js'), serverContent),
			fsPromises.writeFile(path.join(outputDir, 'package.json'), pkgContent)
		]);

		// 5. 复制静态资源与用户功能目录
		await copyDir(staticDir, path.join(outputDir, staticDir));
		await copyDir(customizeDir, path.join(outputDir, customizeDir));
		try {
			await fsPromises.copyFile(path.join(CWD, '.env'), path.join(outputDir, '.env'));
		} catch (err) {
			if (err.code !== 'ENOENT') console.error(`⚠️ 复制 .env 文件失败: ${err.message}`);
		}
		console.log('✅ 资源打包完成'), await installDependencies(outputDir);

		if (hasUserRoutes) console.log('\n🚀 检测到自定义路由,已创建完整服务端入口文件');
		else console.log('\n📄 已生成静态文件服务器（无用户路由）');

		console.log(`👉 启动服务器命令: cd ${outputDir} && node server.js`), setCompilationMode(false); // 设置编译模式为假
	} catch (error) {
		console.error('❌ 编译流程出错:', error.message);
		setCompilationMode(false);
	}
};

// ==================== 5.导出接口与执行编译 ====================
export { compileAllTemplates };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const customDir = process.argv[2];
	compileAllTemplates(customDir);
}