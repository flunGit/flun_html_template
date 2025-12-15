// index.js - 统一导出接口
const runCopyFiles = require('./copy-files.js');

module.exports = {
    compile: require('./compile').compileAllTemplates, startDevServer: require('./dev-server').startServer,
    initProject: (options = {}) => runCopyFiles(options)
};