// 自定义路由示例
const express = require('express');
const fs = require('fs');
const path = require('path');
// 这个文件中的路由会在服务器启动时自动加载
module.exports = {
	// 设置路由的函数
	setupRoutes: function (app) {
		// ============ 元素样式API路由 ============
		// 获取数据文件路径, 读取数据, 定义操作元素(返回顶部图标和切换主题图标)
		const dataFilePath = path.join(__dirname, 'data.json'),
			data = JSON.parse(fs.readFileSync(dataFilePath, 'utf8')), elements = ['topImg', 'themeImg'];

		// 获取元素储存数据
		function getElementStyle(elementKey) {
			return (req, res) => {
				try {
					res.json(data[elementKey]);
				} catch (error) {
					console.error(`读取${elementKey}储存样式数据失败:`, error);
				}
			};
		}

		// 更新元素储存数据
		function updateElementStyle(elementKey) {
			return (req, res) => {
				try {
					const devViewSize = Object.keys(req.body)[0];	 // 请求中的第一个键名是设备视口尺寸
					data[elementKey][devViewSize] = req.body[devViewSize];
					fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
					res.json({ success: true, message: `${elementKey}储存样式数据已更新`, deviceId: devViewSize });
				} catch (error) {
					console.error(`更新${elementKey}储存样式数据失败:`, error);
				}
			};
		}

		// 使用公共函数批量注册元素样式路由
		elements.forEach(element => {
			app.get(`/api/${element}`, getElementStyle(element));
			app.post(`/api/${element}`, express.json(), updateElementStyle(element));
		});

		console.log('✅ 元素样式路由已加载！');
		// ============ 其它自定义API路由 ============
		// 添加一个简单的路由
		app.get('/api/greeting', (req, res) => {
			res.json({ message: '你好！这是来自用户自定义路由的问候！' });
		});

		// 添加一个带参数的路由
		app.get('/api/user/:name', (req, res) => {
			res.json({
				message: `你好, ${req.params.name}!`,
				timestamp: new Date().toLocaleString('zh-CN')
			});
		});

		// 添加POST路由
		app.post('/api/contact', (req, res) => {
			// 这里可以处理表单数据
			res.json({
				success: true,
				message: '感谢您的留言！'
			});
		});

		console.log('✅ 自定义路由已加载！');
	}
};