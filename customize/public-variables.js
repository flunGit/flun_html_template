// 自定义变量...
module.exports = {
    variables: {
        // 基础信息变量
        year: new Date().getFullYear(),
        timestamp: Date.now(),
        baseUrl: '/',
        // 系统信息变量
        nodeEnv: process.env.NODE_ENV || 'development',
        serverTime: new Date().toLocaleString()
    }
};