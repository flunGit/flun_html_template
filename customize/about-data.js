// customize/about-data.js
module.exports = {
    variables: {
        // 用户信息
        user: {
            isLoggedIn: true,
            name: "张三",
            membershipLevel: "VIP",
            isGuest: false
        },

        // 产品信息
        product: {
            stock: 5,
            price: 99.99
        },

        // 产品列表
        products: [
            { name: "产品A", price: 100, stock: 10, isNew: true },
            { name: "产品B", price: 200, stock: 5, isNew: false },
            { name: "产品C", price: 300, stock: 0, isNew: true },
            { name: "产品D", price: 150, stock: 8, isNew: false },
            { name: "产品E", price: 250, stock: 3, isNew: true },
            { name: "产品F", price: 350, stock: 7, isNew: false }
        ],

        // 团队成员信息
        teamMembers: [
            {
                name: "李四",
                position: "技术总监",
                department: "技术部",
                skills: ["JavaScript", "Node.js", "Vue"]
            },
            {
                name: "王五",
                position: "设计师",
                department: "设计部",
                skills: ["UI设计", "UX设计", "原型设计"]
            },
            {
                name: "赵六",
                position: "产品经理",
                department: "产品部",
                skills: ["产品规划", "需求分析", "项目管理"]
            }
        ],

        // 公司信息
        companyInfo: {
            "成立年份": "2015年",
            "员工人数": "50+",
            "总部地点": "北京",
            "业务范围": "软件开发、技术咨询、产品设计",
            "服务客户": "1000+"
        },

        // 测试空数据
        emptyArray: [], // 空数组
        emptyObject: {} // 空对象
    }
};