function initTopImg() {
    const topIcon = document.createElement('img'), api = '/api/topImg';
    topIcon.className = 'scroll-to-top', topIcon.alt = '返回顶部', topIcon.src = '/static/img/top.png';
    // 统一处理按钮显示/隐藏
    function updateTopImg() {
        topIcon.classList.toggle('show', window.pageYOffset > 300);
    };

    // 获取储存样式(位置)并应用
    getStyle(topIcon, api), document.body.append(topIcon);

    // 初始化时立即检查一次,然后添加一个事件监听器以检查更新
    updateTopImg(), window.addEventListener('scroll', updateTopImg);

    // 处理点击和拖动
    mouseOrTouch(topIcon, () => window.scrollTo({ top: 0, behavior: 'smooth' }), api, true);
}

// 初始化
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTopImg);
else initTopImg();