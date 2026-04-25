// /customize/routes.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url), __dirname = path.dirname(__filename),
	dataFile = path.join(__dirname, 'data.json'), imgDir = path.join(__dirname, '../static/img');

// 非认证路由：元素样式、CSS编辑、图片管理、自定义API等
export default {
	setupRoutes: app => {
		app.use(express.json(), express.urlencoded({ extended: true }));

		// ============ 元素样式 API ============
		let data;
		try {
			data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
		} catch (e) {
			data = {};
		}

		const elements = ['topImg', 'themeImg', 'longPic', 'cssEditor', 'preview'],
			getElementStyle = (elementKey) => {
				return (req, res) => {
					try {
						res.json(data[elementKey] || {});
					} catch (error) {
						console.error(`读取${elementKey}样式失败:`, error);
						res.status(500).json({ error: '服务器错误' });
					}
				};
			},
			updateElementStyle = (elementKey) => {
				return (req, res) => {
					try {
						const devViewSize = Object.keys(req.body)[0];
						if (!devViewSize) return res.status(400).json({ error: '缺少设备标识' });
						if (!data[elementKey]) data[elementKey] = {};
						data[elementKey][devViewSize] = req.body[devViewSize];
						fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
						res.json({ success: true, message: `${elementKey}已更新`, deviceId: devViewSize });
					} catch (error) {
						console.error(`更新${elementKey}失败:`, error);
						res.status(500).json({ error: '服务器错误' });
					}
				};
			};

		elements.forEach(element => {
			app.get(`/api/${element}`, getElementStyle(element));
			app.post(`/api/${element}`, updateElementStyle(element));
		});
		console.log('✅ 元素样式路由已加载');

		// ============ CSS 文件操作 ============
		app.get('/api/css', (req, res) => {
			const fileDir = req.query.fileDir;
			if (!fileDir) return res.status(400).json({ error: '缺少文件路径' });
			if (!fileDir.endsWith('.css')) return res.status(403).json({ error: '只允许操作 CSS 文件' });

			try {
				const normalizedPath = fileDir.startsWith('/') ? fileDir.slice(1) : fileDir,
					filePath = path.resolve(normalizedPath);
				if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
				const content = fs.readFileSync(filePath, 'utf8');
				res.type('text/plain').send(content);
			} catch (error) {
				console.error('读取 CSS 失败:', error);
				res.status(500).json({ error: '服务器错误' });
			}
		});

		app.post('/api/css', (req, res) => {
			const { fileDir, content } = req.body;
			if (!fileDir || content === undefined) return res.status(400).json({ error: '缺少参数' });
			if (!fileDir.endsWith('.css')) return res.status(403).json({ error: '只允许操作 CSS 文件' });

			try {
				const normalizedPath = fileDir.startsWith('/') ? fileDir.slice(1) : fileDir,
					filePath = path.resolve(normalizedPath),
					dir = path.dirname(filePath);
				if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
				fs.writeFileSync(filePath, content, 'utf8');
				res.json({ success: true, message: 'CSS 已保存' });
			} catch (error) {
				console.error('保存 CSS 失败:', error);
				res.status(500).json({ error: '服务器错误' });
			}
		});
		console.log('✅ CSS 编辑路由已加载');

		// ============ 图片列表 ============
		app.get('/api/images', (req, res) => {
			try {
				if (!fs.existsSync(imgDir)) return res.json([]);
				const files = fs.readdirSync(imgDir), imgs = files.filter((f) => /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i.test(f));
				res.json(imgs);
			} catch (error) {
				console.error('获取图片列表失败:', error);
				res.status(500).json({ error: '服务器错误' });
			}
		});
		console.log('✅ 非认证路由加载完成（routes.js）');

		// ============ 其它自定义API路由 ============
		app.get('/api/greeting', (req, res) => {
			res.json({ message: '你好！这是来自用户自定义路由的问候！' });
		});

		app.get('/api/user/:name', (req, res) => {
			res.json({
				message: `你好, ${req.params.name}!`, timestamp: new Date().toLocaleString('zh-CN'),
			});
		});

		app.post('/api/contact', (req, res) => {
			res.json({
				success: true, message: '感谢您的留言！',
			});
		});

		console.log('✅ 自定义路由已加载！');
	},
};