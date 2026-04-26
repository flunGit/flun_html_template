/**
 * 模板引擎服务模块
 *
 * 功能区块（按代码顺序）：
 *   1. 常量(路径和正则)及工具函数：高频正则预编译,路径安全检查,基础字符串处理,入口文件识别处理
 *   2. 模板区块处理工具：区块解析和清理（忽略嵌套标签）
 *   3. 包含文件处理：文件包含与依赖追踪
 *   4. 用户自定义功能系统：路由/函数/变量加载
 *   5. 模板功能处理系统：变量动态替换、函数执行、条件判断和循环处理
 *   6. 模板结构验证：标签完整性检查
 *   7. 模板文件操作：路径获取
 *   8. 模板渲染引擎核心：模板合成,文件验证,渲染
 *   9. 模块功能导出
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { pathToFileURL } from 'url';
// ==================== 1. 常量声明及工具函数====================
// 统一所有路径常量，其他文件从此导入
const fsPromises = fs.promises, CWD = process.cwd(), templatesDir = 'templates', templatesAbsDir = path.join(CWD, templatesDir),
	pRes = path.resolve, staticDir = 'static', customizeDir = 'customize', accountDir = 'account', defaultPort = 7296,
	// 预编译所有高频正则表达式
	includeRegex = /(\"|')\[include\s+([^\]]+)\](\"|')|\[include\s+([\S\s]+?)\]/gi, quotedVarRegex = /`\s*{{(.*?)}}\s*`/g,
	userFuncRegex = /\{\{\s*user:\s*([^\s()]+?)\s*\(([^)]*)\)\s*\}\}/g, templateTagRegex = /\[!([^\]]*?)\]|\[\~([^\]]*?)\]/g,
	extendsRegex = /^\[\s*extends\s+([^\]]+?)\s*\][^\r\n]*(?:\r\n|\n|\r|$)/i,
	IfRegex = /\{\{if\s+([^}]+)\}\}([\s\S]*?)((?:\{\{else\s+if[^}]*\}\}[\s\S]*?)*)(?:\{\{else\}\}([\s\S]*?))?\{\{endif\}\}/gi,
	elseIfRegex = /\{\{else\s+if\s+([^}]*)\}\}([\s\S]*?)(?=\{\{(?:else\s+if|else|endif)\}\})/gi,
	forRegex = /\{\{for\s+(\w+)\s+in\s+([^}]+)\}\}([\s\S]*?)(?:\{\{empty\}\}([\s\S]*?))?\{\{endfor\}\}/gi,
	forKeyValueRegex = /\{\{for\s+(\w+)\s*,\s*(\w+)\s+in\s+([^}]+)\}\}([\s\S]*?)(?:\{\{empty\}\}([\s\S]*?))?\{\{endfor\}\}/gi,
	objectPropertyRegex = /\{\{(\w+\.\w+(?:\.\w+)*)\}\}/g, expressionRegex = /\{\{([^}]+)\}\}/g,
	breakRegex = /\{\{\s*break\s*\}\}/g, continueRegex = /\{\{\s*continue\s*\}\}/g, specialCharsRegex = /[.*+?^${}()|[\]\\]/g,

	// 不安全常量
	unsafeKeys = ['__proto__', 'constructor', 'prototype', 'then', 'toString', 'valueOf', 'Object', 'Function', 'Promise'],

	/**
	 * 重置正则表达式的lastIndex属性
	 * @param {RegExp} regex - 需要重置的正则表达式
	 * @returns {RegExp} 重置后的正则表达式
	 */
	_resetRegex = regex => {
		regex.lastIndex = 0;
		return regex;
	},

	/**
	 * 检查路径是否安全（防止目录遍历攻击）
	 * @param {string} requestedPath - 请求的路径
	 * @param {string} baseDir - 基础目录
	 * @returns {boolean} 路径是否安全
	 */
	_isSafePath = (requestedPath, baseDir) => {
		const resolvedPath = pRes(requestedPath);
		return resolvedPath.startsWith(pRes(baseDir));
	},

	/**
	 * 转义字符串中的正则表达式特殊字符
	 * @param {string} string - 待转义字符串
	 * @returns {string} 转义后的安全字符串
	 */
	_escapeRegExp = string => {
		return string.replace(_resetRegex(specialCharsRegex), '\\$&');
	},

	/**
	 * 安全地将值转换为字符串，处理 null、undefined 和对象
	 * @param {any} value - 需要转换的值
	 * @returns {string} 转换后的字符串
	 */
	_safeToString = value => {
		if (value === null || value === undefined) return '';
		if (typeof value === 'object') {
			try {
				return JSON.stringify(value);
			} catch (error) {
				console.warn('对象转字符串失败:', error.message);
				return '';
			}
		}

		return String(value);
	};

/**
 * 动态识别入口文件（优先级策略）
 * 1. 查找包含<!-- @entry -->标记的文件
 * 2. 按优先级列表匹配(index.html > main.html > home.html)
 * 3. 返回首字母排序的第一个HTML文件
 * @param {string} cachedPages - 缓存模板列表
 * @returns {Promise<string>} 入口文件名
 */
const findEntryFile = async cachedPages => {
	// 查找显式标记
	for (const file of cachedPages) {
		const content = await fsPromises.readFile(path.join(templatesAbsDir, file), 'utf8');
		if (content.includes('<!-- @entry -->')) return file;
	}

	const priorityList = ['index.html', 'main.html', 'home.html']; // 优先级列表
	for (const entry of priorityList) if (cachedPages.includes(entry)) return entry;

	return cachedPages.sort()[0]; // 否则按首字母排序(保底)
},

	// ==================== 2. 模板区块处理工具 ====================
	/**
	 * 解析模板内容并定位所有区块的起止位置（忽略嵌套标签）
	 * @param {string} content - 模板内容
	 * @returns {Object} 区块元数据 {blockName: [{startIndex, endIndex, innerContent}]}
	 */
	_findBlockPositions = content => {
		const blocks = {};
		let index = 0;

		while (index < content.length) {
			// 查找开标签
			const startIndex = content.indexOf('[!', index), openEndIndex = content.indexOf(']', startIndex);
			if (startIndex === -1 || openEndIndex === -1) break;

			const openName = content.slice(startIndex + 2, openEndIndex).trim(), closeTag = `[~${openName}]`,
				closeStartIndex = content.indexOf(closeTag, openEndIndex + 1), endIndex = closeStartIndex + closeTag.length;

			// 没有找到闭标签，跳过
			if (closeStartIndex === -1) {
				index = openEndIndex + 1;
				continue;
			}

			// 直接记录当前区块，不检查嵌套情况
			if (!blocks[openName]) blocks[openName] = [];
			blocks[openName].push({ startIndex, endIndex, innerContent: content.slice(openEndIndex + 1, closeStartIndex) });
			index = endIndex;
		}

		return blocks;
	},

	/**
	 * 清除模板中的所有区块标签残留
	 * @param {string} html - 模板内容
	 * @returns {string} 清理后的纯净HTML
	 */
	_cleanTemplateTags = html => {
		return html.replace(_resetRegex(templateTagRegex), '');
	};

// ==================== 3. 包含文件处理 ====================
let isCompilationMode = false;
const includedFiles = new Set(),

/**
 * 设置编译模式并重置文件依赖记录
 * @param {boolean} mode - 是否为编译模式
 */
const setCompilationMode = mode => {
	isCompilationMode = mode;
	if (mode) includedFiles.clear();
};

/**
 * 获取所有被包含的模板文件路径
 * @returns {Set<string>} 包含文件路径集合
 */
const getIncludedFiles = () => {
	return new Set(includedFiles);
};

/**
 * 递归处理模板中的包含指令
 * @param {string} content - 模板内容
 * @param {string} currentFile - 当前处理文件路径
 * @param {Set} inclusionStack - 包含栈，用于检测循环包含
 * @returns {Promise<string>} 处理后的内容
 */
const processIncludes = async (content, currentFile = '', inclusionStack = new Set()) => {
	const matches = [];
	// 收集所有匹配项
	for (const match of content.matchAll(includeRegex)) {
		if (match[1] && match[3]) continue; // 跳过带引号的包含指令
		matches.push({ fullMatch: match[0], fileName: (match[4] || match[2]).trim(), index: match.index });
	}

	if (matches.length === 0) return content; // 无匹配时直接返回
	const sortedMatches = matches.sort((a, b) => b.index - a.index), parts = []; // 按索引降序排序
	let lastIndex = content.length;

	for (const { fullMatch, fileName, index } of sortedMatches) {
		parts.push(content.slice(index + fullMatch.length, lastIndex)), lastIndex = index; // 添加当前匹配后的内容片段

		let includePath;
		if (path.isAbsolute(fileName)) includePath = path.join(templatesAbsDir, fileName);
		else {
			const currentDir = currentFile ? path.dirname(path.join(templatesAbsDir, currentFile)) : templatesAbsDir;
			includePath = pRes(currentDir, fileName);
		}

		// 确保路径安全
		if (!_isSafePath(includePath, templatesAbsDir)) {
			console.warn(`⛔ 包含路径不安全，已跳过: ${fileName}`), parts.push('');
			continue;
		}

		const relativeIncludePath = path.relative(templatesAbsDir, includePath); // 获取相对于模板目录的路径用于记录
		// 检查循环包含
		if (inclusionStack.has(includePath)) {
			console.warn(`⚠️ 循环包含跳过: ${fileName}`), parts.push('');
			continue;
		}
		// 检查自包含
		else if (relativeIncludePath === currentFile) {
			console.warn(`⚠️ 自包含跳过: ${fileName}`), parts.push('');
			continue;
		}

		try {
			let includedContent = await fsPromises.readFile(includePath, 'utf8');

			if (isCompilationMode) includedFiles.add(relativeIncludePath); // 编译模式记录依赖
			// 递归处理嵌套包含
			const newStack = new Set(inclusionStack).add(includePath);
			includedContent = await processIncludes(includedContent, relativeIncludePath, newStack), parts.push(includedContent);
		} catch (error) {
			console.warn(`⛔ 包含失败: ${fileName}`, error.message), parts.push('');
		}
	}

	parts.push(content.slice(0, lastIndex)); // 添加首部内容片段
	return parts.reverse().join(''); 	     // 反转并拼接所有片段
}

// ==================== 4. 用户自定义功能系统 ====================
const userFeatures = {}, writtenFilesToIgnore = [];

/**
 * 运行时监控所有文件写入操作
 */
const monitorFileWrites = () => {
	const sync = fs.writeFileSync, async = fs.writeFile, promise = fsPromises.writeFile, normalize = path.normalize,
		// 内联逻辑
		track = path => {
			if (typeof path === 'string') writtenFilesToIgnore.push(normalize(pRes(CWD, path)));
		};
	setInterval(() => writtenFilesToIgnore.length > 0 && writtenFilesToIgnore.shift(), 1500);

	fs.writeFileSync = (file, ...args) => {
		const r = sync.call(fs, file, ...args);
		process.nextTick(track, file);
		return r;
	};

	fs.writeFile = (file, ...args) => {
		const r = async.call(this, file, ...args);
		process.nextTick(track, file);
		return r;
	};

	fsPromises.writeFile = (file, ...args) => {
		const r = promise.call(this, file, ...args);
		process.nextTick(track, file);
		return r;
	};

	return () => { fs.writeFileSync = sync, fs.writeFile = async, fsPromises.writeFile = promise; };
},

	/**
	* 异步安全加载模块（兼容 ESM 和 CJS）
	*/
	_safeImport = async modulePath => {
		try {
			const mod = await import(pathToFileURL(modulePath).href), { default: dft } = mod;
			// 统一导出：优先使用 default 导出（ESM 默认导出 / CJS module.exports）
			// 如果 default 存在且包含 setupRoutes / functions / variables,则用 default,否则用整个模块
			const hasDefault = dft && typeof dft === 'object';
			if (hasDefault && (
				typeof dft.setupRoutes === 'function' || typeof dft.functions === 'object' || typeof dft.variables === 'object'
			)) return dft;
			return mod;
		} catch (error) {
			console.error(`加载模块失败: ${modulePath}`, error.message);
			return null;
		}
	};

/**
 * 加载用户自定义功能（路由/函数/变量）
 * @param {Object} app - Express应用实例（仅服务器模式需要）
 * @param {boolean} isCompileMode - 是否为编译模式
 * @returns {Promise<Object>} 用户功能集合
 */
const loadUserFeatures = async (app = null, isCompileMode = false) => {
	const featuresDir = path.join(CWD, customizeDir);

	// 检查并创建目录（如果是编译模式）
	try {
		await fsPromises.access(featuresDir);
	} catch {
		if (isCompileMode) {
			await fsPromises.mkdir(featuresDir, { recursive: true });
			console.log(`📁 已创建用户功能目录: ${customizeDir}`);
		}
	}

	userFeatures.variables = {}, userFeatures.functions = {};
	try {
		const files = await fsPromises.readdir(featuresDir), jsFiles = files.filter(file => file.endsWith('.js')).sort();
		console.log(`🔧 正在加载 (${jsFiles.length}个用户自定义功能文件):`);

		for (const file of jsFiles) {
			const featurePath = path.join(featuresDir, file), userFeature = await _safeImport(featurePath);

			if (!userFeature) {
				console.log(` ❌ ${file} - 加载失败`);
				continue;
			}

			// 注册路由（仅限服务器模式且有 app 实例）
			if (typeof userFeature.setupRoutes === 'function' && app) userFeature.setupRoutes(app);

			// 收集函数
			if (userFeature.functions && typeof userFeature.functions === 'object') {
				Object.keys(userFeature.functions).forEach(funcName => {
					if (typeof userFeature.functions[funcName] === 'function')
						userFeatures.functions[`${file.replace('.js', '')}.${funcName}`] = userFeature.functions[funcName];
				});
			}

			// 收集变量
			if (userFeature.variables && typeof userFeature.variables === 'object')
				Object.assign(userFeatures.variables, userFeature.variables);

			console.log(` ✅ ${file} - 加载成功`);
		}
		console.log('✅ 所有用户功能加载完成');
	} catch (error) {
		console.error('读取用户功能目录失败:', error.message);
	}

	return userFeatures;
},

	// ==================== 5. 模板功能处理系统 ====================
	/**
	 * 检查模板内容中是否还有未处理的标签
	 * @param {string} content - 模板内容
	 * @returns {boolean} 是否存在未处理的标签
	 */
	_hasUnprocessedTags = content => {
		const tagsToCheck = [forRegex, forKeyValueRegex, IfRegex, userFuncRegex, expressionRegex, objectPropertyRegex];

		return tagsToCheck.some(regex => {
			_resetRegex(regex);
			return regex.test(content);
		});
	},

	/**
	 * 处理所有循环结构，包括简单循环和键值对循环
	 * 支持特性：
	 * - 简单循环: {{for item in collection}}...{{empty}}...{{endfor}}
	 * - 键值对循环: {{for key, value in object}}...{{empty}}...{{endfor}}
	 * - empty分支: 当集合为空时显示替代内容
	 * - 自动循环变量: item_index, item_isFirst, item_isLast
	 * - 循环控制: 支持{{break}}和{{continue}}语句
	 * @param {string} content - 模板内容
	 * @param {Object} variables - 变量上下文
	 * @returns {string} 处理后的内容，所有循环结构已展开为实际内容
	 */
	_processLoops = (content, variables) => {
		let result = content;

		// 循环处理器
		const processLoop = (itemNames, collectionName, loopContent, emptyContent, variables) => {
			const namesArray = Array.isArray(itemNames) ? itemNames : [itemNames];

			if (namesArray.some(name => unsafeKeys.includes(name))) {
				console.warn(`检测到不安全的循环变量名: ${namesArray.join(', ')}`);
				return '';
			}

			try {
				const collection = _evaluateExpression(collectionName, variables),
					isEmpty = !collection || (Array.isArray(collection) && collection.length === 0) ||
						(typeof collection === 'object' && Object.keys(collection).length === 0);

				if (isEmpty) return emptyContent ? processVariables(emptyContent, variables) : '';
				let loopResult = '';
				const primaryVar = namesArray[0], isKeyValue = namesArray.length > 1,
					entries = isKeyValue ? Object.entries(collection) : collection.map((v, i) => [i, v]);

				for (let i = 0; i < entries.length; i++) {
					const [key, value] = entries[i],
						loopVariables = {
							...variables, [primaryVar]: isKeyValue ? key : value, [`${primaryVar}_index`]: i,
							[`${primaryVar}_isFirst`]: i === 0, [`${primaryVar}_isLast`]: i === entries.length - 1
						};

					if (isKeyValue) loopVariables[namesArray[1]] = value;
					let processedContent = processVariables(loopContent, loopVariables);
					// 检查并处理循环控制标签
					if (processedContent.includes('{{break}}')) {
						processedContent = processedContent.replace(_resetRegex(breakRegex), '');
						break;
					} else if (processedContent.includes('{{continue}}')) {
						processedContent = processedContent.replace(_resetRegex(continueRegex), '');
						continue;
					}

					loopResult += processedContent;
				}

				return loopResult;
			} catch (error) {
				console.error(`处理循环时出错: ${collectionName}`, error.message);
				return '';
			}
		}

		// 处理键值对循环
		result = result.replace(_resetRegex(forKeyValueRegex), (_match, keyName, valueName, collectionName, loopContent,
			emptyContent) => processLoop([keyName, valueName], collectionName, loopContent, emptyContent, variables));

		// 处理简单循环
		result = result.replace(_resetRegex(forRegex), (_match, itemName, collectionName, loopContent, emptyContent) =>
			processLoop(itemName, collectionName, loopContent, emptyContent, variables));

		return result;
	},

	/**
	 * 处理条件判断结构，支持多分支条件判断
	 * 语法支持：
	 * - 主条件: {{if condition}}...{{endif}}
	 * - 多分支: {{if condition}}...{{else if condition2}}...{{else}}...{{endif}}
	 * - 嵌套条件: 支持最多20层嵌套，通过迭代方式处理
	 * 使用COMPLEX_IF_REGEX匹配主结构，ELSE_IF_REGEX匹配else if分支
	 * @param {string} content - 模板内容
	 * @param {Object} variables - 变量上下文
	 * @returns {string} 处理后的内容，条件判断已根据变量值解析
	 */
	_processConditionals = (content, variables) => {
		let result = content, hasChanges = true, iterationCount = 0;
		const maxIterations = 20;

		while (hasChanges && iterationCount < maxIterations) {
			iterationCount++, hasChanges = false;
			// 使用新的正则表达式来匹配多分支条件
			result = result.replace(_resetRegex(IfRegex), (_match, ifCondition, ifContent, elseIfBlocks, elseContent) => {
				try {
					const allContent = ifContent + (elseIfBlocks || '') + (elseContent || '');
					if (allContent.includes('{{if')) hasChanges = true; 			   // 检查是否有嵌套条件
					if (_evaluateExpression(ifCondition, variables)) return ifContent; // 检查主条件

					// 处理 else if 分支
					if (elseIfBlocks)
						for (const elseIfMatch of elseIfBlocks.matchAll(elseIfRegex)) {
							const elseIfCondition = elseIfMatch[1], elseIfContent = elseIfMatch[2];
							if (_evaluateExpression(elseIfCondition, variables)) return elseIfContent;
						}

					return elseContent || ''; // 处理 else 分支
				} catch (error) {
					console.error(`处理条件判断时出错: ${ifCondition}`, error.message);
					return '';
				}
			});
		}

		return result;
	},

	/**
	 * 执行用户自定义函数
	 * @param {string} funcName - 函数名称
	 * @param {...any} args - 函数参数
	 * @returns {any} 函数执行结果
	 */
	_executeUserFunction = (funcName, ...args) => {
		try {
			if (!userFeatures.functions[funcName]) throw new Error(`找不到函数: ${funcName}`);
			return userFeatures.functions[funcName](...args);
		} catch (error) {
			console.error(`执行用户函数 ${funcName} 时出错:`, error.message);
			return null;
		}
	},

	/**
	 * 处理用户自定义函数调用，支持多种参数类型和复杂表达式
	 * 函数调用格式: {{user:functionName(arg1, arg2, ...)}}
	 * 参数类型支持：
	 * - 字符串: "string" 或 'string'（引号内的内容作为字面量）
	 * - 变量: {{variable}}（变量引用，使用当前上下文中的值）
	 * - 布尔值: true/false（直接转换为布尔类型）
	 * - 数字: 123（直接转换为数字类型）
	 * - 特殊值: null/undefined（转换为对应JavaScript值）
	 * 函数从customize目录加载，支持模块化组织
	 * @param {string} content - 模板内容
	 * @param {Object} variables - 变量上下文
	 * @returns {string} 处理后的内容，函数调用已替换为执行结果
	 */
	_processUserFunctions = (content, variables) => {
		return content.replace(_resetRegex(userFuncRegex),
			(_match, funcCall, argsStr) => {
				try {
					// 检查函数名安全性
					if (unsafeKeys.includes(funcCall)) {
						console.warn(`检测到不安全的函数名: ${funcCall}`);
						return '';
					}

					const cleanedArgs = argsStr.split(',')
						.map(arg => arg.trim()).filter(arg => arg !== '')
						.map(arg => {
							// 字符串处理
							const quotedMatch = arg.match(/^["'](.*)["']$/);
							if (quotedMatch) return quotedMatch[1];

							// 变量处理 - 增强安全性检查
							const varMatch = arg.match(/\{\{(\w+)\}\}/);
							if (varMatch) {
								const varName = varMatch[1];
								if (unsafeKeys.includes(varName)) {
									console.warn(`检测到不安全的变量名: ${varName}`);
									return undefined;
								}
								if (variables[varName] !== undefined) return variables[varName];
							}

							// 特殊值和数字处理
							if (arg === 'true') return true;
							if (arg === 'false') return false;
							if (arg === 'null') return null;
							if (arg === 'undefined') return undefined;
							if (!isNaN(Number(arg))) return Number(arg);

							// 安全性检查
							if (unsafeKeys.includes(arg)) {
								console.warn(`检测到不安全的变量名: ${arg}`);
								return undefined;
							}
							return variables[arg] !== undefined ? variables[arg] : arg;
						}).filter(arg => arg !== undefined); // 过滤掉不安全的值

					const funcResult = _executeUserFunction(funcCall, ...cleanedArgs);
					return _safeToString(funcResult);
				} catch (error) {
					console.error(`处理用户函数调用 ${funcCall} 时出错:`, error.message);
					return '';
				}
			});
	},

	/**
	 * 根据点分隔的路径从对象中获取嵌套属性值
	 * 支持多级属性访问，如: user.profile.name
	 * 使用reduce方法逐级访问属性，遇到undefined时停止并返回
	 * 安全处理不存在的路径，避免抛出异常
	 * @param {Object} obj - 源对象
	 * @param {string} path - 点分隔的属性路径
	 * @returns {any} 属性值，如果路径不存在则返回undefined
	 */
	_getValueByPath = (obj, path) => {
		return path.split('.').reduce((current, key) => {
			if (current === null || current === undefined) return undefined;
			if (unsafeKeys.includes(key)) return undefined; // 防止原型污染
			return Object.hasOwnProperty.call(current, key) ? current[key] : undefined; // 检查属性是否存在
		}, obj);
	},

	/**
	 * 创建安全的沙箱环境用于表达式求值，防止恶意代码执行
	 * 复制原始变量但阻止原型访问，确保安全性
	 * 添加安全的工具函数支持：
	 * - 基础类型: String, Number, Boolean, Array, Date, Math, JSON
	 * - 逻辑运算符: and, or, not, eq, neq, gt, lt, gte, lte
	 * 使用Object.create(null)创建无原型的干净对象
	 * @param {Object} variables - 原始变量上下文
	 * @returns {Object} 安全的沙箱环境，包含变量和受限函数
	 */
	_createSafeSandbox = variables => {
		const safeVariables = Object.create(null);

		// 复制原始变量但阻止原型访问
		for (const key in variables)
			if (Object.hasOwnProperty.call(variables, key) && !unsafeKeys.includes(key)) safeVariables[key] = variables[key];

		// 添加安全的工具函数
		const safeFunctions = {
			String, Number, Boolean, Array, Date, Math, JSON,
			// 添加逻辑运算符支持
			and: (a, b) => a && b, or: (a, b) => a || b, not: a => !a, eq: (a, b) => a === b, neq: (a, b) => a !== b,
			gt: (a, b) => a > b, lt: (a, b) => a < b, gte: (a, b) => a >= b, lte: (a, b) => a <= b
		};

		return { ...safeVariables, ...safeFunctions };
	},

	/**
	 * 表达式求值函数,在安全沙箱环境中执行JavaScript表达式
	 * 使用vm模块创建安全上下文,避免使用eval
	 * 将沙箱环境中的变量和函数作为参数传入执行上下文
	 * 支持完整的JavaScript表达式语法，包括:
	 * - 算术运算: +, -, *, /, %
	 * - 比较运算: ==, !=, ===, !==, >, <, >=, <=
	 * - 逻辑运算: &&, ||, !
	 * - 条件运算: ?:
	 * - 函数调用: func(arg1, arg2)
	 * - 属性访问: obj.property
	 * @param {string} expr - 待求值的JavaScript表达式
	 * @param {Object} variables - 变量上下文
	 * @returns {any} 表达式求值结果，求值失败时返回null
	 */
	_evaluateExpression = (expr, variables) => {
		try {
			// 创建安全沙箱
			const context = vm.createContext({
				..._createSafeSandbox(variables), process: undefined, global: undefined, console: Object.create(null),
				setTimeout: undefined, setInterval: undefined, setImmediate: undefined, Buffer: undefined, require: undefined
			}),
				result = vm.runInContext(`(${expr})`, context, { timeout: 1500, displayErrors: false }); // 执行表达式

			return result;
		} catch (error) {
			console.error(`表达式求值失败: ${expr}`, error.message);
			return null;
		}
	},

	/**
	 * 处理对象属性访问、简单变量替换和复杂表达式求值
	 * 使用evaluateExpression函数在安全沙箱中执行表达式
	 * 功能包括：
	 * - 还原带反引号变量: `{{variable}}` → {{variable}}
	 * - 对象属性访问: {{object.property}}支持多级属性访问
	 * - 简单变量替换: {{variable}}替换为变量值
	 * - 跳过特殊标签: 用户函数,循环,控制和判断
	 * 表达式支持特性：
	 * - 数学运算: {{1 + 2 * 3}}
	 * - 逻辑运算: {{a && b || c}}
	 * - 比较运算: {{value > 10}}
	 * - 三元运算符: {{condition ? value1 : value2}}
	 * - 函数调用: {{Math.max(a, b)}}
	 * 使用OBJECT_PROPERTY_REGEX匹配对象属性访问模式
	 * 使用getValueByPath函数解析多级属性路径
	 * @param {string} content - 模板内容
	 * @param {Object} variables - 变量上下文
	 * @returns {string} 处理后的内容，简单变量和对象属性已替换
	 */
	_processVariablesAndExpressions = (content, variables) => {
		let result = content;
		result = result.replace(_resetRegex(quotedVarRegex), (_match, inner) => `{{${inner}}}`); // 处理带反引号变量

		// 处理对象属性访问
		result = result.replace(_resetRegex(objectPropertyRegex), (_match, path) => {
			try {
				const value = _getValueByPath(variables, path);
				return _safeToString(value);
			} catch (error) {
				console.warn(`处理对象属性访问 ${path} 时出错:`, error.message);
				return '';
			}
		});

		// 处理简单变量替换
		Object.entries(variables).forEach(([key, value]) => {
			if (unsafeKeys.includes(key)) return;
			try {
				const stringValue = _safeToString(value), regex = new RegExp(`{{\\s*${_escapeRegExp(key)}\\s*}}`, 'g');
				result = result.replace(regex, stringValue);
			} catch (error) {
				console.warn(`处理变量 ${key} 时出错:`, error.message);
			}
		});

		// 处理复杂表达式求值
		result = result.replace(_resetRegex(expressionRegex), (match, expression) => {
			if (!expression.trim()) return '';			    // 跳过空表达式
			if (expression.includes('user:')) return match; // 跳过已经被处理的用户函数调用

			// 跳过条件判断标签、循环标签以及循环控制标签
			const trimmedExpr = expression.trim();
			if (trimmedExpr.startsWith('if ') || trimmedExpr === 'else' || trimmedExpr === 'endif' ||
				trimmedExpr.startsWith('for ') || trimmedExpr === 'endfor' || trimmedExpr === 'empty' ||
				trimmedExpr === 'break' || trimmedExpr === 'continue') return match;

			try {
				// 尝试直接求值表达式
				const value = _evaluateExpression(expression.trim(), variables);
				return _safeToString(value);
			} catch (error) {
				console.warn(`表达式求值失败: ${expression}`, error.message);
				return '';
			}
		});

		return result;
	},

	// 模块处理函数数组（所有依赖函数已定义，顺序安全）
	processingPhases = [_processLoops, _processConditionals, _processUserFunctions, _processVariablesAndExpressions],

	/**
	 * 迭代式模板处理器
	 * 按数组顺序多次处理模板，直到没有变化或达到最大迭代次数
	 * @param {string} content - 模板内容
	 * @param {Object} variables - 变量上下文
	 * @param {number} maxIterations - 最大迭代次数:10
	 * @returns {string} 处理后的内容
	 */
	_processIteratively = (content, variables, maxIterations = 10) => {
		let result = content, previousResult, iteration = 0;
		do {
			previousResult = result;
			for (const handler of processingPhases) result = handler(result, variables); // 处理模板
			iteration++;
		} while (result !== previousResult && iteration < maxIterations && _hasUnprocessedTags(result));

		if (iteration >= maxIterations) console.warn(`模板处理达到最大迭代次数(${maxIterations}),可能包含无限循环或复杂嵌套`);
		return result;
	};

/**
 * 迭代式变量处理主入口函数
 * 多次扫描模板内容，直到没有未处理的标签或达到最大迭代次数
 * @param {string} content - 待处理的模板内容
 * @param {Object} requestVariables - 请求级变量，与用户变量合并后使用
 * @returns {string} 处理后的内容，所有动态部分已被替换为实际值
 */
const processVariables = (content, requestVariables = {}) => {
	const allVariables = { ...userFeatures.variables, ...requestVariables };
	return _processIteratively(content, allVariables); // 使用迭代式处理替代线性管道
},

	// ==================== 6. 模板结构验证 ====================
	/**
	 * 验证模板标签的完整性和嵌套结构
	 * @param {string} content - 模板内容
	 * @returns {Array} 结构错误信息集合
	 */
	_validateTemplateStructure = (content) => {
		const stack = [], errors = [];
		let line = 1;

		// 公共标签解析
		const parseTag = (i, tagType, newLine) => {
			const endIndex = content.indexOf(']', i);
			if (endIndex === -1) {
				errors.push(`第 ${newLine} 行: ${tagType}标签缺少闭合方括号`);
				return { B: true };
			}

			const rawName = content.slice(i + 2, endIndex);
			if (rawName.trim() === '') {
				errors.push(`第 ${newLine} 行: 空${tagType}标签名称`);
				return { C: true, endIndex };
			}
			const invalidChars = ['[', ']', '{', '}', '~'], foundInvalidChars = invalidChars.filter(c => rawName.includes(c));
			if (foundInvalidChars.length > 0) {
				errors.push(`第 ${newLine} 行: 标签名称包含非法字符 ${foundInvalidChars.join(',')}`);
				return { C: true, endIndex };
			}

			return { name: rawName.trim(), endIndex };
		}

		// 重构后的主循环
		for (let i = 0; i < content.length; i++) {
			const char = content[i];
			if (char === '\n') line++;

			// 开标签检测
			if (content.startsWith('[!', i)) {
				const { B, C, endIndex, name } = parseTag(i, '开', line);
				if (B) break;
				if (C) {
					i = endIndex;
					continue;
				}
				stack.push({ name, line }), i = endIndex;
			}
			// 闭标签检测
			else if (content.startsWith('[~', i)) {
				const { B, C, endIndex, name } = parseTag(i, '闭', line);
				if (B) break;
				if (C) {
					i = endIndex;
					continue;
				}

				if (stack.length === 0) errors.push(`第 ${line} 行: 多余的闭标签 '${name}'`);
				else {
					const lastOpen = stack[stack.length - 1];
					if (lastOpen.name === name) stack.pop();
					else errors.push(`第 ${line} 行: 标签不匹配, 期望 '${lastOpen.name}' 但找到 '${name}'`);
				}
				i = endIndex;
			}
		}

		stack.forEach(tag => { errors.push(`第 ${tag.line} 行: 未闭合的区块 '${tag.name}'`); });
		return errors;
	};

// ==================== 7. 模板文件操作 ====================
/**
 * 获取模板目录下所有可用的HTML文件路径（排除base.html）
 * @returns {Promise<string[]>} 过滤后HTML文件路径数组
 */
const getAvailableTemplates = async () => {
	try {
		const getAllHtmlFiles = async (dir) => {
			const results = [], items = await fsPromises.readdir(dir);
			for (const item of items) {
				const fullPath = path.join(dir, item), stat = await fsPromises.stat(fullPath);
				if (stat.isDirectory()) results.push(...(await getAllHtmlFiles(fullPath)));
				else if (item !== 'base.html' && path.extname(item).toLowerCase() === '.html') {
					const relativePath = path.relative(templatesAbsDir, fullPath);
					results.push(relativePath.replaceAll('\\', '/'));
				}
			}
			return results;
		}, templates = await getAllHtmlFiles(templatesAbsDir);
		if (templates.length === 0) throw new Error('未找到任何可用模板文件，请检查模板目录');

		return templates;
	} catch (error) {
		console.error('操作失败:', error.message), process.exit(1);
	}
},

	// ==================== 8. 模板渲染引擎核心 ====================
	/**
	 * 确保HTML文档类型声明位于文件开头
	 * @param {string} html - 渲染后的HTML内容
	 * @returns {string} 标准化文档
	 */
	_ensureDoctypeFirst = html => {
		return html.trim().toLowerCase().startsWith('<!doctype') ? html : `<!DOCTYPE html>\n${html}`;
	},

	/**
	 * 核心模板合成算法- 将页面模板内容合并到基础模板中
	 * @param {string} baseContent - 基础模板
	 * @param {string} templateContent - 页面模板
	 * @returns {string} 合成后的HTML
	 */
	_renderTemplateContent = (baseContent, templateContent) => {
		const baseBlocks = _findBlockPositions(baseContent), templateBlocks = _findBlockPositions(templateContent),
			replacements = [];
		let finalHtml = baseContent;

		// 收集所有需要替换的区块
		for (const [name, templateBlockArray] of Object.entries(templateBlocks)) {
			const baseBlockArray = baseBlocks[name] || [], minLength = Math.min(templateBlockArray.length, baseBlockArray.length);

			for (let i = 0; i < minLength; i++) {
				const { startIndex, endIndex } = baseBlockArray[i];
				replacements.push({ innerContent: templateBlockArray[i].innerContent, startIndex, endIndex });
			}
		}

		replacements.sort((a, b) => b.startIndex - a.startIndex); // 按索引从大到小排序，避免替换时影响后续索引
		// 执行替换
		for (const { startIndex, innerContent, endIndex } of replacements)
			finalHtml = finalHtml.slice(0, startIndex) + innerContent + finalHtml.slice(endIndex);

		return _ensureDoctypeFirst(_cleanTemplateTags(finalHtml));
	};

/**
 * 模板文件结构验证入口
 * @param {string} fileName - 目标文件
 * @param {boolean} [isDev=false] - 开发模式标识
 * @throws {Error} 校验失败时抛出异常
 */
const validateTemplateFile = async (fileName, isDev = false) => {
	const filePath = path.join(templatesAbsDir, fileName), content = await fsPromises.readFile(filePath, 'utf8'),
		errors = _validateTemplateStructure(content);

	if (errors.length > 0) {
		const errorMsg = `模板 ${fileName} 结构错误:\n${errors.join('\n')}`;
		if (isDev) console.error(errorMsg);
		else throw new Error(errorMsg);
	}
}

/**
 * 模板渲染函数- 处理模板继承关系
 * @param {string} templateFile - 模板文件名
 * @returns {Promise<string>} 渲染后的HTML内容（不包含变量替换）
 *
 * 核心流程：
 * 1. 检测[extends]指令
 * 2. 剥离继承指令行
 * 3. 加载基模板并合并内容
 * 4. 返回合成后的模板
 */
const renderTemplate = async templateFile => {
	const templatePath = path.join(templatesAbsDir, templateFile),
		templateContent = await fsPromises.readFile(templatePath, 'utf8'), // 读取模板内容
		extendsMatch = templateContent.match(_resetRegex(extendsRegex));   // 匹配[extends]指令

	if (!extendsMatch) return _renderTemplateContent(templateContent, '');
	const remainingContent = templateContent.slice(extendsMatch[0].length), // 移除整行（包括指令和注释）
		baseTemplateFile = extendsMatch[1].trim(), basePath = path.isAbsolute(baseTemplateFile)
			? path.join(templatesAbsDir, baseTemplateFile) : path.join(path.dirname(templatePath), baseTemplateFile);

	// 检查基模板是否存在
	try {
		await fsPromises.access(basePath);
	} catch (error) {
		throw new Error(`基模板文件不存在: ${baseTemplateFile} (在 ${templateFile} 中引用)`);
	}
	const baseContent = await fsPromises.readFile(basePath, 'utf8');
	return _renderTemplateContent(baseContent, remainingContent); // 执行模板合成
}


// ==================== 9. 模块功能导出 ====================
export {
	path, fsPromises, CWD,
	templatesAbsDir, templatesDir, staticDir, customizeDir, accountDir, defaultPort, // 路径常量
	getAvailableTemplates, findEntryFile,				   	  // 模板文件操作
	validateTemplateFile, renderTemplate,				   	  // 模板渲染引擎核心
	processIncludes, setCompilationMode, getIncludedFiles, 	  // 包含文件处理
	processVariables,									   	  // 变量处理系统
	loadUserFeatures, monitorFileWrites, writtenFilesToIgnore // 用户功能系统,监听写入文件,热重载忽略文件
};