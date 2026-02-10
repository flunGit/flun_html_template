// index.d.ts
/**
 * HTML开发服务器模块 主要功能：
 * ```js
 * startDevServer(); // 启动开发服务器
 * initProject();    // 初始化项目文件
 * compile();        // 编译所有模板文件
 * ```
 * ---
 *    -
 * ```js
 *  // 启动服务器示例
 *  const { startDevServer } = require('flun-html-template');
 *  startDevServer(7296,true); // 7296为开发服务器默认端口(可自己指定), true表示启用热重载(默认启用)
 *
 *  // -----------------------------------------------
 *  // 恢复文件示例
 *  const { initProject } = require('flun-html-template');
 *  initProject({
 *      mode: 'skip-dirs',  // 模式:跳过已存在的文件(默认)
 *      verbose: true       // 启用控制台详细输出
 *  });
 *
 *  // -----------------------------------------------
 *  // 编译模板示例
 *  const { compile } = require('flun-html-template');
 *  compile();
 * ```
 *    -
 */
declare module 'flun-html-template' {
    // ==================== 核心函数类型 ====================

    /**
     * 启动开发服务器
     * @param port 可选端口号,默认使用配置文件中的端口:7296
     * @param hotReload 是否启用热重载，默认:true
     * @returns Promise<number> 实际使用的端口号
     *
     * @example
     * ```javascript
     * const { startDevServer } = require('flun-html-template');
     * // 方式1: 使用默认端口和热重载
     *      startDevServer();
     *
     * // 方式2: 指定端口并禁用热重载
     *      startDevServer(8080, false)
     *
     * // 方式3: 使用async/await
     * (async () => {
     *   try {
     *           await startDevServer(3000);
     *      } catch (error) {
     *           console.error('服务器启动失败:', error);
     *      }
     * })();
     * ```
     */
    export function startDevServer(port?: number, hotReload?: boolean): Promise<number>;

    /**
     * 初始化项目文件
     * 提供与命令行工具相同的文件拷贝功能，支持多种复制模式
     *
     * 【拷贝行为说明】
     * -
     * - 默认行为(skip-dirs):
     *   - 跳过已存在的目录,没有的目录执行复制
     *   - 根目录已有的文件跳过,根目录没有的文件复制
     *
     * 【通过命令行调用时的参数对应关系】
     * 1. --overwrite     → mode: 'overwrite'  (覆盖所有已存在的文件和目录)
     * 2. --skip-files    → mode: 'skip-files' (跳过所有已存在的文件,仅复制新文件)
     * 3. --skip-dirs     → mode: 'skip-dirs'  (跳过已存在的目录)
     *  - --verbose       → verbose: true      (显示详细执行记录)
     *  - --help          → 显示帮助信息(仅在命令行调用时生效)
     *
     * 【特殊处理文件】
     * 不受模式影响的文件(总是覆盖)：
     *   f-README.md、f-CHANGELOG.md
     *
     * 【拷贝项目列表】
     * -
     *   - templates, customize, static, dev.js, build.js, restoreDefault.js, f-README.md, f-CHANGELOG.md
     *
     * @param options 初始化选项
     * @returns Promise<void>
     *
     * @example
     * ```javascript
     * const { initProject } = require('flun-html-template');
     *
     * // 示例1: 使用默认设置（跳过已存在的目录）
     * initProject().then(() => {
     *   console.log('项目初始化完成（跳过已存在的目录）');
     * });
     *
     * // 示例2: 覆盖所有文件并显示详细信息
     * initProject({
     *   mode: 'overwrite',
     *   verbose: true
     * }).then(() => {
     *   console.log('已覆盖所有项目文件');
     * });
     *
     * // 示例3: 仅复制新文件（跳过已存在的文件）
     * initProject({
     *   mode: 'skip-files',
     *   verbose: false  // 静默模式
     * }).then(() => {
     *   console.log('仅复制了新文件');
     * });
     *
     * // 示例4: 在异步函数中使用
     * async function setupProject() {
     *   try {
     *     await initProject({ mode: 'overwrite' });
     *     console.log('项目文件已完全恢复');
     *   } catch (error) {
     *     console.error('初始化失败:', error);
     *   }
     * }
     *
     * ```
     */
    export function initProject(options?: InitProjectOptions): Promise<void>;

    /**
     * 编译所有模板文件
     * 将模板文件编译为最终的HTML文件，生成到dist目录中
     *
     * @returns Promise<void>
     *
     * @example
     * ```javascript
     * const { compile } = require('flun-html-template');
     *
     * // 示例1: 基础编译
     * compile().then(() => {
     *   console.log('模板编译完成，文件已生成到dist目录');
     * });
     *
     * // 示例2: 在构建流程中使用
     * async function buildProject() {
     *   console.log('开始编译模板...');
     *   await compile();
     *   console.log('模板编译完成，开始打包静态资源...');
     *   // 这里可以添加其他构建步骤
     * }
     *
     * // 示例3: 错误处理
     * compile().catch(error => {
     *   console.error('编译过程中发生错误:');
     *   console.error('错误信息:', error.message);
     *   console.error('请检查模板语法是否正确');
     * });
     * ```
     */
    export function compile(): Promise<void>;

    // ==================== 选项接口 ====================

    /**
     * 项目初始化选项
     *
     * 此选项接口与命令行参数一一对应，用于编程方式调用时控制文件复制行为
     */
    export interface InitProjectOptions {
        /**
         * 文件复制模式:
         *  - 'overwrite': 覆盖所有已存在的文件和目录
         *  - 'skip-files': 跳过所有已存在的文件,仅复制新文件
         *  - 'skip-dirs': 跳过已存在的目录(默认)
         * @default 'skip-dirs'
         */
        mode?: 'overwrite' | 'skip-files' | 'skip-dirs';

        /**
         * 是否启用详细输出模式,显示详细的操作日志
         * 对应命令行参数 --verbose
         * @default false
         */
        verbose?: boolean;
    }
}