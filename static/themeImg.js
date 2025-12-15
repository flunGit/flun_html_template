function initThemeImg() {
    const themeIcon = document.createElement('img'), api = '/api/themeImg';
    themeIcon.id = 'theme', themeIcon.alt = '切换主题';

    // 设置图标回调(根据主题切换图片路径)
    ThemeModule.setIconUpdateCallback(function (actualTheme) {
        if (themeIcon) themeIcon.src = actualTheme === 'light' ? '/static/img/dark.png' : '/static/img/light.png';
    });

    // 获取储存样式(位置)并应用
    getStyle(themeIcon, api), document.body.append(themeIcon);

    // 处理点击和拖动
    mouseOrTouch(themeIcon, () => ThemeModule.toggleTheme(), api);
}

// 页面加载完成后创建主题图标
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initThemeImg);
else initThemeImg();