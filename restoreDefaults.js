const { initProject } = require('lunjack-html-template');

// 恢复文件
initProject({
    mode: 'skip-files', // 模式:跳过已存在的文件
    verbose: true
});