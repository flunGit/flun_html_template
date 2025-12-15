// ===================== 主题模块 (优化版) =====================
/**
 * 主题管理模块，负责处理主题切换功能
 *
 * 主要优化：
 * 1. 移除了重复的主题计算和设置逻辑
 * 2. 使用永久系统主题监听器替代频繁销毁/重建
 * 3. 简化初始化流程，同时保持功能完整
 *
 * 主要功能：
 * 1. 支持三种主题模式：system（跟随系统）、light（明亮模式）、dark（暗黑模式）
 * 2. 自动保存用户偏好到本地存储
 * 3. 自动监听系统主题变化（当处于系统模式时）
 * 4. 提供图标更新回调机制，只在浅色和深色模式间切换
 *
 * 使用说明：
 * 1. 模块加载后自动初始化
 * 2. 使用 setIconUpdateCallback 设置图标更新回调
 * 3. 使用 toggleTheme 或 setPreference 切换主题
 *
 * @namespace
 */
const ThemeModule = (function () {
	let currentPreference = 'system', iconUpdateCallback = null; 			// 私有变量,封装模块内部状态(主题偏好和图标更新回调函数)
	const systemMedia = window.matchMedia('(prefers-color-scheme: dark)'); // 系统主题监听器

	/**
	 * 加载用户保存的主题偏好
	 * @private
	 */
	function loadPreference() {
		const savedPreference = localStorage.getItem('themePreference'); // 从本地存储获取保存的偏好设置
		// 验证保存的偏好是否有效
		if (savedPreference && ['system', 'light', 'dark'].includes(savedPreference)) currentPreference = savedPreference;
	}

	/**
	 * 计算实际应用的主题
	 * @private
	 * @returns {'light' | 'dark'} 实际应用的主题
	 */
	function getActualTheme() {
		if (currentPreference === 'system') return systemMedia.matches ? 'dark' : 'light'; // 当处于系统模式时，返回当前系统主题
		return currentPreference; 														   // 否则返回用户指定的主题
	}

	/**
	 * 应用主题到文档根元素
	 * @private
	 */
	function applyTheme() {
		const targetTheme = getActualTheme(); 							  // 获取实际应用的主题
		document.documentElement.setAttribute('data-theme', targetTheme); // 设置文档根元素的data-theme属性
	}

	/**
	 * 安全更新主题切换图标
	 * @private
	 */
	function safeUpdateIcon() {
		// 检查图标更新回调是否已设置
		if (iconUpdateCallback && typeof iconUpdateCallback === 'function') {
			try {
				const actualTheme = getActualTheme(); // 获取当前实际应用的主题
				iconUpdateCallback(actualTheme); 	  // 调用回调函数并传递当前实际主题
			} catch (e) {
				console.warn('主题图标更新失败', e);
			}
		}
	}

	/**
	 * 处理系统主题变化事件
	 * @private
	 */
	function handleSystemThemeChange() {
		if (currentPreference === 'system') applyTheme(), safeUpdateIcon(); // 仅当处于系统模式时响应变化(更新主题和图标)
	}

	systemMedia.addEventListener('change', handleSystemThemeChange);        // 初始化系统主题监听器
	// 公共API
	return {
		/**
		 * 初始化主题模块
		 * @method
		 */
		init: function () {
			// 加载保存的偏好并应用主题
			loadPreference(), applyTheme();
			const updateOnReady = () => safeUpdateIcon();
			if (document.readyState === 'complete') updateOnReady();			// DOM加载完成后更新图标
			else document.addEventListener('DOMContentLoaded', updateOnReady); // 否则监听DOMContentLoaded事件
		},

		/**
		 * 设置图标更新回调
		 *
		 * 使用说明：
		 * 此方法用于设置主题切换时的图标更新回调
		 * 回调函数将接收当前实际应用的主题值（'light' 或 'dark'）
		 *
		 * @param {Function} callback - 图标更新回调函数
		 * @method
		 */
		setIconUpdateCallback: function (callback) {
			if (typeof callback === 'function') iconUpdateCallback = callback, safeUpdateIcon(); // 设置后立即更新一次图标状态
		},

		/**
		 * 设置主题偏好
		 *
		 * 使用说明：
		 * 此方法直接设置主题偏好，适用于需要精确控制主题的场景
		 *
		 * 示例：
		 * ThemeModule.setPreference('dark'); // 设置为暗黑模式
		 * ThemeModule.setPreference('system'); // 设置为跟随系统
		 *
		 * @param {'system' | 'light' | 'dark'} preference - 主题偏好
		 * @method
		 */
		setPreference: function (preference) {
			if (['system', 'light', 'dark'].indexOf(preference) === -1) return;// 验证输入有效性
			currentPreference = preference;									   // 更新当前偏好
			localStorage.setItem('themePreference', preference);			   // 保存到本地存储
			applyTheme(), safeUpdateIcon();									   // 应用新主题并更新图标
		},

		/**
		 * 切换主题（在浅色和深色模式间切换）
		 *
		 * 使用说明：
		 * 此方法用于在浅色和深色模式间切换，忽略系统模式
		 * 如果当前是系统模式，会先切换到当前实际主题
		 *
		 * 示例：
		 * document.getElementById('theme-toggle').addEventListener('click', () => {
		 *     ThemeModule.toggleTheme();
		 * });
		 *
		 * @method
		 */
		toggleTheme: function () {
			// 获取当前实际主题,切换到相反的主题（忽略系统模式）
			const currentTheme = this.getActualTheme(), newTheme = currentTheme === 'light' ? 'dark' : 'light';
			this.setPreference(newTheme); // 设置新偏好
		},

		/**
		 * 获取当前偏好设置
		 *
		 * 使用说明：
		 * 此方法用于获取当前的主题偏好设置
		 *
		 * 示例：
		 * const currentPref = ThemeModule.getPreference();
		 * console.log('当前主题偏好:', currentPref);
		 *
		 * @returns {string} 当前主题偏好
		 * @method
		 */
		getPreference: function () {
			return currentPreference;
		},

		/**
		 * 获取实际应用的主题
		 *
		 * 使用说明：
		 * 此方法用于获取实际应用的主题（考虑系统偏好）
		 *
		 * 示例：
		 * const actualTheme = ThemeModule.getActualTheme();
		 * console.log('实际应用的主题:', actualTheme);
		 *
		 * @returns {string} 实际应用的主题 ('light' 或 'dark')
		 * @method
		 */
		getActualTheme: function () {
			return getActualTheme();
		}
	};
})();

ThemeModule.init(); // 初始化主题模块
// ===================== 使用示例 =====================
/**
 * 基本使用：
 * 1. 在页面加载后自动初始化(直接引入模块即可)

//  切换主题：
	document.getElementById('themeToggle').addEventListener('click', () => ThemeModule.toggleTheme());

// 直接设置主题（'system'、'light' 或 'dark'）：
	ThemeModule.setPreference('dark');

// 包含图标的使用：
	// 1. 设置图标回调（只需一次）
		ThemeModule.setIconUpdateCallback(function (actualTheme) {
			const iconElement = document.getElementById('theme-icon');
			if (iconElement) {
				const iconMap = {
					light: 'fa-sun', // 明亮模式图标
					dark: 'fa-moon'  // 暗黑模式图标
				};
				iconElement.className = `fas ${iconMap[actualTheme]}`;
			}
		});

	// 2. 按钮点击切换主题和图标
		document.getElementById('themeToggle').addEventListener('click', () => {
			ThemeModule.toggleTheme(); // 同时切换主题和图标
		});

	// 添加图标动画效果（CSS示例）
	.theme-toggle i {
		transition: transform 0.3s ease;
	}
	.theme-toggle:hover i {
		transform: rotate(20deg);
	}
*/