// 自定义工具函数示例

module.exports = {
	functions: {
		// 简单计算器函数
		add: function (a, b) {
			return a + b;
		},

		subtract: function (a, b) {
			return a - b;
		},

		multiply: function (a, b) {
			return a * b;
		},

		divide: function (a, b) {
			return b !== 0 ? a / b : '错误: 除零错误';
		},

		// 简单问候函数
		greet: function (name) {
			return `你好, ${name}!`;
		},

		// 带时间的问候
		greetWithTime: function (name) {
			return `你好, ${name}! 现在是 ${new Date().toLocaleTimeString()}`;
		},

		// 格式化日期
		formatDate: function (date) {
			// 处理无参数调用
			if (arguments.length === 0) {
				return new Date().toLocaleDateString('zh-CN');
			}

			// 处理字符串输入
			if (typeof date === 'string') {
				const parsedDate = new Date(date);
				return isNaN(parsedDate.getTime()) ? '字符串无效' : parsedDate.toLocaleDateString('zh-CN');
			}

			// 处理其他类型
			const dateObj = new Date(date);
			return isNaN(dateObj.getTime()) ? '无效日期' : dateObj.toLocaleDateString('zh-CN');
		}
	}
};