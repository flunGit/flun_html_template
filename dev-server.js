/**
 * 开发服务器模块 - 动态模板渲染服务器
 *
 * 模块结构：
 * 1. 依赖导入与服务器初始化
 * 2. 服务器配置与端口管理(parseAndValidatePort,parseServerConfig)
 * 3. 全局CORS中间件和静态资源配置(/static路径)
 * 4. 服务器生命周期管理(requiresUrlEncoding, printAvailablePages, startServer)
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
	loadUserFeatures, templatesDir, staticDir, defaultPort
} = require('./services/templateService');

const app = express();
let server, io, watcher, cachedPages = [];// 缓存模板列表

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
	res.setHeader('X-Frame-Options', 'DENY');
	// res.setHeader('Access-Control-Allow-Credentials', 'true');// 是否启用凭据（cookies、认证等）

	// 处理预检请求（OPTIONS）
	if (req.method === 'OPTIONS') {
		res.setHeader('Content-Length', '0');
		return res.status(204).end();
	}

	next();
});
app.use('/static', express.static(path.join(process.cwd(), staticDir)));

// ==================== 4.服务器生命周期管理 ====================
/**
 * 检测文件名是否需要URL编码
 * @param {string} filename - 待检测的文件名
 * @returns {boolean} - 包含特殊字符时返回true
 */
function requiresUrlEncoding(filename) {
	const safeChars = /^[a-zA-Z0-9\-_.~]+$/;
	return !safeChars.test(filename);
}

/**
 * 控制台输出可访问页面信息
 * @param {string[]} pages - 有效的模板文件名集合
 * @param {number} port - 服务器端口号
 * @param {boolean} hotReloadEnabled - 是否启用热重载
 */
function printAvailablePages(pages, port, hotReloadEnabled) {
	console.log('开发服务器启动成功!'), console.log(`访问地址: http://localhost:${port}`);

	if (hotReloadEnabled) console.log('✅ 热重载功能已启用 - 文件修改时将自动刷新浏览器');
	console.log('\n可访问页面:');

	pages.sort().forEach(page => {
		const url = `http://localhost:${port}/${page}`, encodedUrl = `http://localhost:${port}/${encodeURI(page)}`,
			needsEncoding = requiresUrlEncoding(page);

		if (needsEncoding) console.log(`  原始路径: ${url} (需复制访问)`), console.log(`  编码路径: ${encodedUrl} (直接访问)`);
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
		// 使用统一配置解析
		const config = parseServerConfig({ port, hotReload });

		await loadUserFeatures(app, false), cachedPages = await getAvailableTemplates();
		for (const page of cachedPages) await validateTemplateFile(page, true);

		if (config.hotReload) setupHotReload(); // 设置热重载
		printAvailablePages(cachedPages, config.port, config.hotReload);

		server = http.createServer(app); 			 // 创建服务器
		if (config.hotReload) {
			io = socketIo(server);
			io.engine.on("headers", (headers) => headers["Content-Type"] = "text/html; charset=utf-8");
		}

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
		if (!res.headersSent) res.status(500).send('服务器处理请求时发生错误');
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
    	    socket.on('hot-reload', function() {
    	      console.log('[热重载] 检测到文件更改，重新加载页面...');
    	      setTimeout(function() {
    	        window.location.reload();
    	      }, 100);
    	    });
    	  })();
    	</script>
   `;

	if (html.includes('</body>')) return html.replace('</body>', `${socketScript}</body>`); // 将脚本注入到body结束标签之前
	return html + socketScript; 															// 如果没有body标签，直接追加到末尾
}

/**
 * 设置文件监听和热重载功能
 */
function setupHotReload() {
	// 监听模板目录和静态文件目录
	const watchDirs = [templatesDir, path.join(process.cwd(), staticDir)].filter(dir => {
		try {
			return fsSync.existsSync(dir);
		} catch {
			return false;
		}
	}),	// 文件变更事件处理函数
		handleFileEvent = (event, filePath) => {
			console.log(`[热重载] 检测到文件${event}: ${path.relative(process.cwd(), filePath)}`);
			if (io) io.emit('hot-reload'); // 通知所有连接的客户端刷新页面
		};
	watcher = chokidar.watch(watchDirs, { ignored: /(^|[\/\\])\../, persistent: true, ignoreInitial: true }); // 忽略隐藏文件
	watcher.on('change', (filePath) => handleFileEvent('更改', filePath))
		.on('add', (filePath) => handleFileEvent('添加', filePath))
		.on('error', (error) => console.error('[热重载] 文件监听错误:', error));
}

// ==================== 7.导出接口与启动执行 ====================
module.exports = {
	startServer, closeServer: () => {
		if (watcher) watcher.close();
		if (server) server.close();
	}
};

if (require.main === module) startServer().catch(error => (console.error('服务器启动失败:', error), process.exit(1)));