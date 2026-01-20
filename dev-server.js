/**
 * 开发服务器模块 - 动态模板渲染服务器
 *
 * 模块结构：
 * 1. 依赖导入与服务器初始化
 * 2. 服务器配置与端口管理(parseAndValidatePort,parseServerConfig)
 * 3. 全局CORS中间件和静态资源配置(/static路径)
 * 4. 服务器生命周期管理(printAvailablePages, startServer)
 * 5. 请求页面路由处理(自动路由与模板渲染)
 * 6. 热重载功能实现(文件监听与WebSocket通信)
 * 7. 导出接口与启动执行(module.exports , startServer)
 *
 */

// ==================== 1.依赖导入与服务器初始化 ====================
const express = require('express');
const fsSync = require('fs');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const chokidar = require('chokidar');
const {
	getAvailableTemplates, findEntryFile, validateTemplateFile, renderTemplate, processIncludes, processVariables,
	loadUserFeatures, writtenFilesToIgnore, templatesAbsDir, staticDir, customizeDir, defaultPort, monitorFileWrites
} = require('./services/templateService');

const app = express(), CWD = process.cwd(), staticAbsDir = path.join(CWD, staticDir), customizeAbsDir = path.join(CWD, customizeDir);
let server, io, watcher, cachedPages = [], unmountMonitor = null;

// ==================== 工具函数 ====================
/**
 * 创建带WebSocket的服务器
 */
function createServerWithSocket(app, config) {
	server = http.createServer(app);
	if (config.hotReload) {
		io = socketIo(server);
		io.engine.on("headers", headers => headers["Content-Type"] = "text/html; charset=utf-8");
	}
}

/**
 * 清理资源
 */
function cleanupResources() {
	if (watcher) watcher.close(), watcher = null;
	if (io) io.close(), io = null;
	if (unmountMonitor) unmountMonitor(); unmountMonitor = null;
}

/**
 * 生成页面URL
 */
function generateUrls(page, port) {
	const baseUrl = `http://localhost:${port}`, url = `${baseUrl}/${page}`,
		needsEncoding = !/^[a-zA-Z0-9\-_.~]+$/.test(page); // 检查是否包含需要编码的字符

	return { url, encodedUrl: `${baseUrl}/${encodeURI(page)}`, needsEncoding };
}

// ==================== 2.服务器配置与端口管理 ====================
/**
 * 解析并验证端口值
 * @param {string|number} portValue - 端口值
 * @param {string} source - 来源描述（用于错误消息）
 * @returns {number} 有效的端口号或默认值
 */
function parseAndValidatePort(portValue, source) {
	const portNum = parseInt(portValue);

	// 检查是否为有效数字且在有效端口范围内 (1-65535)
	if (!isNaN(portNum) && portNum > 0 && portNum < 65536) return portNum;
	console.warn(`警告: ${source} "${portValue}" 无效,已启用默认端口:${defaultPort}`);
	return defaultPort;
}

/**
 * 统一服务器配置解析函数
 *
 * 配置解析优先级：
 *  端口：
 *    1. 命令行参数 (--port 或 -p)
 *    2. 函数参数 (options.port)
 *    3. 环境变量 (process.env.PORT)
 *    4. 默认值 (常量 defaultPort)
 *
 *  热重载：
 *    1. 命令行参数 (--hot-reload/--no-hot-reload)
 *    2. 函数参数 (options.hotReload)
 *    3. 默认值 (true)
 */
function parseServerConfig(options = {}) {
	let port, hotReload;
	// 解析端口参数 - 优先级: 命令行 > 函数参数 > 环境变量 > 默认值
	const args = process.argv.slice(2), portArgIndex = args.findIndex(arg => arg === '--port' || arg === '-p'),
		portArgValue = portArgIndex !== -1 ? args[portArgIndex + 1] : null, { port: P, hotReload: H } = options;

	if (portArgValue) port = parseAndValidatePort(portArgValue, '命令行参数');
	else if (P !== undefined) port = parseAndValidatePort(P, '函数参数');
	else if (process.env.PORT) port = parseAndValidatePort(process.env.PORT, '环境变量 PORT');
	else port = defaultPort; // 默认端口

	// 解析热重载参数 - 优先级: 命令行 > 函数参数 > 默认值
	if (args.includes('--hot-reload')) hotReload = true;
	else if (args.includes('--no-hot-reload')) hotReload = false;
	else if (H !== undefined) hotReload = H;
	else hotReload = true; // 默认启用

	return { port, hotReload };
}


// ==================== 3.全局CORS中间件和静态资源配置 ====================
app.use((req, res, next) => {
	// 基本CORS头
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-CSRF-Token');
	res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
	res.setHeader('Access-Control-Max-Age', '86400'); // 预检请求缓存24小时
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'SAMEORIGIN');
	res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
	// res.setHeader('Access-Control-Allow-Credentials', 'true');// 是否启用凭据（cookies、认证等）

	// 处理预检请求（OPTIONS）
	if (req.method === 'OPTIONS') {
		res.setHeader('Content-Length', '0');
		return res.status(204).end();
	}

	next();
});
app.use('/static', express.static(staticAbsDir));

// ==================== 4.服务器生命周期管理 ====================
/**
 * 控制台输出可访问页面信息
 * @param {string[]} pages - 有效的模板文件名集合
 * @param {number} port - 服务器端口号
 * @param {boolean} hotReload - 是否启用热重载
 */
function printAvailablePages(pages, port, hotReload) {
	console.log(`开发服务器启动成功!\n访问地址: http://localhost:${port}`);
	if (hotReload) console.log(`✅ 热重载功能已启用(监听目录->${templatesAbsDir},${staticDir},${customizeDir})`);

	console.log('\n可访问页面:');
	pages.sort().forEach(page => {
		const { url, encodedUrl, needsEncoding } = generateUrls(page, port);

		if (needsEncoding) console.log(`  原始路径: ${url} (需复制访问)\n  编码路径: ${encodedUrl} (直接访问)`);
		else console.log(`  直接访问: ${url}`);
	});

	console.log(`\n共发现 ${pages.length} 个可用模板`), console.log('-----------------------------------');
}

/**
 * 服务器启动主函数
 * @async
 * @param {number} [port] - 可选端口号
 * @param {boolean} [hotReload] - 是否启用热重载
 */
const startServer = async (port, hotReload) => {
	try {
		const config = parseServerConfig({ port, hotReload });

		await loadUserFeatures(app, false), cachedPages = await getAvailableTemplates();
		for (const page of cachedPages) await validateTemplateFile(page, true);

		if (config.hotReload) setupHotReload();
		printAvailablePages(cachedPages, config.port, config.hotReload);
		createServerWithSocket(app, config);

		server.listen(config.port, () => {
			console.log(`服务器运行中，按 Ctrl+C 退出`), console.log('-----------------------------------');
		});

		return config.port;
	} catch (error) {
		console.error('服务器启动失败:', error.message), process.exit(1);
	}
};

// ==================== 5.请求页面路由处理 ====================
/**
 * 核心请求处理中间件
 * @async
 * @desc 处理逻辑：
 *  1. 根路径重定向到入口html
 *  2. 自动补充.html扩展名
 *  3. 模板渲染管线（继承→包含→变量替换）
 *  4. 开发模式下注入热重载客户端脚本
 */
app.use(async (req, res, next) => {
	try {
		const decodedPath = decodeURIComponent(req.path);
		if (decodedPath === '/') {
			const entryFile = await findEntryFile(cachedPages);
			return res.redirect(`/${entryFile}`);
		}

		const templateFile = decodedPath.endsWith('.html') ? decodedPath.slice(1) : `${decodedPath.slice(1)}.html`;
		if (cachedPages.includes(templateFile)) {
			let rendered = await renderTemplate(templateFile);
			rendered = await processIncludes(rendered, templateFile);
			rendered = processVariables(rendered, { currentUrl: decodedPath, query: req.query ? JSON.stringify(req.query) : '' });

			if (io) rendered = injectHotReloadScript(rendered); // 如果启用了热重载，注入客户端脚本
			return res.type('html').send(rendered);
		}

		next();
	} catch (error) {
		console.error(`处理请求时出错: ${error.message}`), console.error(error.stack);
	}
});

// ==================== 6.热重载功能实现 ====================
/**
 * 注入热重载客户端脚本到HTML
 * @param {string} html - 原始HTML内容
 * @returns {string} 注入脚本后的HTML
 */
function injectHotReloadScript(html) {
	if (/hot-reload-socket|socket\.io\.js/.test(html)) return html; // 避免重复注入
	const socketScript = `
        <script src="/socket.io/socket.io.js"></script>
        <script>
          (function() {
            var socket = io();
            // 监听热重载事件
            socket.on('hot-reload', (delay) => {
              console.log('[热重载] 检测到文件更改,' + delay + '毫秒后重新加载页面...');
              setTimeout(() => window.location.reload(), delay);
            });
          })();
        </script>
   `;

	if (html.includes('</body>')) return html.replace('</body>', `${socketScript}</body>`);
	return html + socketScript;
}

/**
 * 设置文件监听和热重载功能
 */
function setupHotReload() {
	// 监听模板目录、静态文件目录和后端目录
	const watchDirs = [templatesAbsDir, staticAbsDir, customizeAbsDir].filter(dir => fsSync.existsSync(dir));
	if (watchDirs.length === 0) return console.warn('[热重载] 没有可监听的目录');

	unmountMonitor = monitorFileWrites(); // 启用持续文件写入监控并获取卸载函数
	// 文件变更事件处理函数
	const handleFileEvent = (event, filePath) => {
		const normalizedPath = path.normalize(filePath);
		if (writtenFilesToIgnore.has(normalizedPath)) return; // 忽略文件

		const isBackendFile = filePath.startsWith(customizeAbsDir);
		if (isBackendFile) {
			console.log(`检测到${event}了${normalizedPath}后端文件,[热重载] 执行服务器重启并刷新页面...`);
			io.emit('hot-reload', 3500);            // 通知浏览器延迟刷新
			setTimeout(() => restartServer(), 500); // 延迟后重启服务器
		}
		else {
			console.log(`检测到${event}了${normalizedPath}前端文件,[热重载] 已刷新页面...`);
			// 如果删除了HTML模板文件，从缓存中移除
			if (event === '删除' && filePath.startsWith(templatesAbsDir) && filePath.endsWith('.html')) {
				const templateName = path.relative(templatesAbsDir, filePath).replace(/\\/g, '/');
				cachedPages = cachedPages.filter(page => page !== templateName);
			}

			io.emit('hot-reload', 100);   // 通知浏览器刷新
		}
	};

	// 设置监听器(忽略隐藏文件)
	watcher = chokidar.watch(watchDirs, {
		ignored: /(^|[\/\\])\../, persistent: true, ignoreInitial: true
	});

	watcher.on('change', (filePath) => handleFileEvent('更改', filePath))
		.on('add', (filePath) => handleFileEvent('添加', filePath))
		.on('unlink', (filePath) => handleFileEvent('删除', filePath))
		.on('error', (error) => console.error('[热重载] 文件监听错误:', error));
}

/**
 * 重启服务器
 */
async function restartServer() {
	try {
		const port = server.address().port; // 保存当前端口
		cleanupResources();                 // 关闭现有资源

		if (server) {
			server.close(async () => {
				try {
					// 清除自定义模块的缓存
					Object.keys(require.cache).forEach(key => {
						if (key.includes(customizeDir)) delete require.cache[key];
					});

					// 重新加载用户功能模块和获取模板列表
					await loadUserFeatures(app, true), cachedPages = await getAvailableTemplates();

					// 重新启动服务器
					const config = { port, hotReload: true };
					createServerWithSocket(app, config);

					server.listen(config.port, () => setupHotReload()); // 重新设置热重载
				} catch (error) {
					console.error('[热重载] 服务器重启失败:', error);
				}
			});
		}
	} catch (error) {
		console.error('[热重载] 重启过程中发生错误:', error);
	}
}

// ==================== 7.导出接口与启动执行 ====================
module.exports = {
	startServer, closeServer: () => {
		cleanupResources();
		if (server) server.close();
	}
};
if (require.main === module) startServer().catch(error => (console.error('服务器启动失败:', error), process.exit(1)));