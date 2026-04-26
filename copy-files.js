#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取 __dirname (仅用于迁移)
const __filename = fileURLToPath(import.meta.url), __dirname = path.dirname(__filename),
    // 常量定义(直接覆盖文件列表和复制列表)
    alwaysOverwriteFiles = ['f-README.md', 'f-CHANGELOG.md'], filesToCopy = ['templates', 'customize', 'static', '.env',
        'dev.js', 'build.js', 'restoreDefaults.js', 'f-README.md', 'f-CHANGELOG.md'],

    // 日志函数
    log = (message, config, isErrorLog = false) => {
        if (isErrorLog) console.log(`❌ ${message}`);
        else if (config.verbose) console.log(`✅ ${message}`); // 非错误日志只在详细模式下显示
    },

    // 显示帮助信息
    showHelp = () => {
        console.log(`
    文件复制工具 - 使用说明:
        默认行为: 跳过已存在的目录，没有的目录执行复制，根目录已有的文件跳过，根目录没有的文件复制

        主模式(3选1):
          --overwrite          覆盖所有已存在的包文件和目录
          --skip-files         跳过所有已有文件，所有没有的文件执行复制后创建
          --skip-dirs          （默认）

        可选参数(2选1):
          --account            启用登录模式（会复制 templates/account 和 customize/account.js）
          --no-account         禁用登录模式，跳过复制上述文件/目录（默认）
        可选参数:
          --verbose            详细模式,显示操作信息

        帮助:
          --help               显示此帮助信息
    `);
        process.exit(0);
    },

    // 判断是否应该跳过文件
    shouldSkipFile = (destExists, isRootItem, config, shouldAlwaysOverwrite) => {
        if (!destExists || shouldAlwaysOverwrite) return false;
        else if (config.mode === 'skip-files') return true;
        else if (config.mode === 'skip-dirs' && isRootItem) return true;
        return false;
    },

    // 处理权限错误
    handlePermissionError = (filePath, config) => {
        log(`权限拒绝: ${filePath}`, config, true);
        throw new Error(`权限拒绝: ${filePath}`);
    },

    // 确保目录存在
    ensureDirectoryExists = async (dirPath, config) => {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
            if (error.code === 'EACCES') handlePermissionError(dirPath, config);
            else if (error.code !== 'EEXIST') throw error;
        }
    },

    // 检查路径是否存在
    pathExists = async path => {
        try {
            await fs.access(path);
            return true;
        } catch {
            return false;
        }
    },

    // 复制文件或目录
    copyFileOrDir = async (src, dest, isRootItem = true, config) => {
        if (!config.account) {
            const accountDir = path.join(config.packageDir, 'templates', 'account'),
                accountFile = path.join(config.packageDir, 'customize', 'account.js');
            if (src === accountDir || src === accountFile) return log(`跳过account相关:${path.basename(src)}`, config);
        }

        try {
            if (!await pathExists(src)) throw new Error(`源文件不存在: ${src}`);
            const stat = await fs.stat(src);
            if (stat.isDirectory()) await copyDirectory(src, dest, isRootItem, config);
            else await copyFile(src, dest, isRootItem, config);
        } catch (error) {
            log(`复制失败: ${src} -> ${dest}, ${error.message}`, config, true);
            throw error;
        }
    },

    // 复制目录
    copyDirectory = async (src, dest, isRootItem = true, config) => {
        const destExists = await pathExists(dest); // 检查目标目录是否存在
        if (destExists && (config.mode === 'skip-dirs')) return log(`跳过已存在目录: ${path.basename(dest)}`, config);

        await ensureDirectoryExists(dest, config); // 创建目标目录
        const items = await fs.readdir(src);       // 读取源目录内容
        log(`复制目录: ${src} -> ${dest} (${items.length} 个项目)`, config);

        // 并行复制所有项目
        await Promise.all(items.map(item => copyFileOrDir(path.join(src, item), path.join(dest, item), false, config)));
    },

    // 复制单个文件
    copyFile = async (src, dest, isRootItem = true, config) => {
        // 检查目标文件是否存在
        const destExists = await pathExists(dest), fileName = path.basename(src),
            shouldAlwaysOverwrite = alwaysOverwriteFiles.includes(fileName);

        // 判断是否应该跳过文件
        if (shouldSkipFile(destExists, isRootItem, config, shouldAlwaysOverwrite)) return log(`跳过已存在文件:${fileName}`, config);

        // 记录覆盖操作
        if (destExists) {
            if (shouldAlwaysOverwrite) log(`直接覆盖: ${fileName}`, config);
            else if (config.mode === 'overwrite') log(`覆盖文件: ${fileName}`, config);
        }

        const destDir = path.dirname(dest);
        await ensureDirectoryExists(destDir, config); // 确保目标目录存在

        // 执行复制
        try {
            await fs.copyFile(src, dest), log(`已复制: ${fileName}`, config);
        } catch (error) {
            if (error.code === 'EACCES') handlePermissionError(dest, config);
            else throw error;
        }
    };

// 主函数
const runCopyFiles = async (options = {}) => {
    const config = {
        mode: options.mode || 'skip-dirs',
        verbose: options.verbose ?? false,
        account: options.account ?? false,
        packageDir: __dirname                        // 包所在目录，用于路径判断
    },
        targetDir = path.resolve(__dirname, '../..'); // 目标目录（项目根目录）

    console.log('✅ 开始复制文件'); // 关键消息总是显示
    if (config.verbose) {
        console.log(`✅ 包目录: ${__dirname}`);
        console.log(`✅ 目标目录: ${targetDir}`);
        console.log(`✅ 待处理: ${filesToCopy.join(', ')}`);
        console.log(`✅ 模式: ${config.mode}`);
        console.log(`✅ account 模式: ${config.account ? '启用' : '禁用'}`);
    }

    try {
        // 并行复制所有文件/目录
        await Promise.all(
            filesToCopy.map(item => copyFileOrDir(path.join(__dirname, item), path.join(targetDir, item), true, config)));

        console.log('✅ 文件复制完成！');
        // 添加专业支持信息（总是显示）
        console.log('\n✅ 专业支持:');
        console.log('✅ • 开发文档: https://www.npmjs.com/package/flun-html-template');
        console.log('✅ • 技术支持: cn@flun.top');
        console.log('✅ • 企业微信: https://work.weixin.qq.com/kfid/kfc44c370d4ddbac6f0');
        console.log('✅ 安装完成！');
    } catch (error) {
        const errorMsg = `❌ 复制过程中发生错误: ${error.message}`;
        console.log(errorMsg);
        throw new Error(errorMsg);
    }
};

export { runCopyFiles };
// 如果通过命令行调用
if (process.argv[1] === __filename) {
    if (process.argv.includes('--help')) showHelp();  // 处理命令行参数

    // 确定模式
    let mode;
    if (process.argv.includes('--overwrite')) mode = 'overwrite';
    else if (process.argv.includes('--skip-files')) mode = 'skip-files';
    else if (process.argv.includes('--skip-dirs')) mode = 'skip-dirs';
    else mode = 'skip-dirs';

    let account;
    if (process.argv.includes('--account')) account = true;
    else if (process.argv.includes('--no-account')) account = false;
    else account = false; // 默认

    runCopyFiles({ mode, verbose: process.argv.includes('--verbose'), account })
        .catch(error => (console.log(`❌ 未处理的错误: ${error.message}`), process.exit(1)));
}