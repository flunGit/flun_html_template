// 项目/static/mouseOrTouch.js
const devViewSize = `${window.innerWidth}x${window.innerHeight}`; // 使用设备视口作为设备唯一标识
/**
 * 获取元素储存样式数据(位置)并通过API数据应用样式
 * @param {HTMLElement} element - 需要设置位置的DOM元素
 * @param {string} [api=null] - 获取位置信息的路由API
 * @returns {void}
 */
function getStyle(element, api = null) {
    fetch(api).then(res => res.ok ? res.json() : Promise.reject(`Network error:${element}`))
        .then(position => Object.assign(element.style, position[devViewSize]?.style ?? {}))
        .catch(error => console.error(`获取${devViewSize}的储存数据失败:`, error));
}

/**
 * 为元素添加鼠标和触摸事件支持，实现拖拽和点击功能
 * @param {HTMLElement} element - 需要添加交互功能的DOM元素
 * @param {Function} onClick - 点击事件回调函数
 * @param {string} [api=null] - 更新位置信息的路由API
 * @param {boolean} [isEndShow=false] - 拖拽结束后是否显示元素
 * @returns {void}
 */
function mouseOrTouch(element, onClick, api = null, isEndShow = false) {
    let dragStartX, dragStartY, initialX, initialY, hasDragged = false, isDragging = false, touchStartTime = 0;

    element.onclick = (e) => {
        if (hasDragged) {
            e.preventDefault(), e.stopPropagation();
            return;
        }
        if (onClick) onClick();
    };

    // 元素事件
    element.addEventListener('mousedown', startDrag);
    element.addEventListener('touchstart', handleTouchStart, { passive: false });

    // 文档事件
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    /**
     * 处理触摸开始事件
     * @param {TouchEvent} e - 触摸事件对象
     */
    function handleTouchStart(e) {
        touchStartTime = Date.now(), startDrag(e);
    }

    /**
     * 处理触摸移动事件
     * @param {TouchEvent} e - 触摸事件对象
     */
    function handleTouchMove(e) {
        drag(e);
    }

    /**
     * 处理触摸结束事件
     * @param {TouchEvent} e - 触摸事件对象
     */
    function handleTouchEnd(e) {
        const touchDuration = Date.now() - touchStartTime;
        if (!hasDragged && touchDuration < 300) e.preventDefault(), onClick();
        endDrag();
    }

    /**
     * 开始拖拽操作
     * @param {MouseEvent|TouchEvent} e - 鼠标或触摸事件对象
     */
    function startDrag(e) {
        e.preventDefault(), isDragging = true, hasDragged = false;

        const rect = element.getBoundingClientRect();
        initialX = rect.left, initialY = rect.top;

        if (e.type === 'mousedown' || e.type === 'touchstart') {
            const clientX = e.type === 'mousedown' ? e.clientX : e.touches[0].clientX,
                clientY = e.type === 'mousedown' ? e.clientY : e.touches[0].clientY;

            dragStartX = clientX, dragStartY = clientY;
        }

        element.style.transition = 'none', element.style.cursor = 'grabbing';
    }

    /**
     * 处理拖拽移动
     * @param {MouseEvent|TouchEvent} e - 鼠标或触摸事件对象
     */
    function drag(e) {
        if (!isDragging) return;
        e.preventDefault();

        let clientX, clientY;
        if (e.type === 'mousemove') clientX = e.clientX, clientY = e.clientY;
        else clientX = e.touches[0].clientX, clientY = e.touches[0].clientY;

        const deltaX = clientX - dragStartX, deltaY = clientY - dragStartY;
        if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) hasDragged = true;

        const newX = initialX + deltaX, newY = initialY + deltaY,
            maxX = window.innerWidth - element.offsetWidth, maxY = window.innerHeight - element.offsetHeight;

        element.style.left = `${Math.min(Math.max(0, newX), maxX)}px`;
        element.style.top = `${Math.min(Math.max(0, newY), maxY)}px`;
        element.style.right = 'auto', element.style.bottom = 'auto';
    }

    /**
     * 结束拖拽操作
     */
    function endDrag() {
        if (!isDragging) return;
        const { left, top, right, bottom } = element.style,
            finalPosition = { [devViewSize]: { style: { left, top, right, bottom } } }; // 创建带设备标识的样式对象

        isDragging = false, element.style.transition = '', element.style.cursor = '';
        if (isEndShow) element.classList.add('show');

        // 更新元素样式(位置)到后端
        if (api && hasDragged) {
            fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json', }, body: JSON.stringify(finalPosition) })
                .then(res => res.ok ? res.json() : Promise.reject(`Network error:${element}`))
                .catch(error => console.error(`更新${devViewSize}储存样式数据失败:`, error));
        }
        setTimeout(() => hasDragged = false, 100); // 短暂延迟后重置拖动标记，允许下次点击
    }
}