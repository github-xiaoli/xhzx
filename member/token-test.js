// API 检测页面逻辑

document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素
    const cookieStatusSpan = document.getElementById('cookie-status');
    const tokenValiditySpan = document.getElementById('token-validity');
    const githubUserSpan = document.getElementById('github-user');
    const rateLimitSpan = document.getElementById('rate-limit');
    
    const refreshStatusBtn = document.getElementById('refresh-status-btn');
    const clearTokenBtn = document.getElementById('clear-token-btn');
    
    const keyInput = document.getElementById('key-input');
    const fetchTokenBtn = document.getElementById('fetch-token-btn');
    const keyResultDiv = document.getElementById('key-result');
    
    const tokenInput = document.getElementById('token-input');
    const testTokenBtn = document.getElementById('test-token-btn');
    const saveTokenBtn = document.getElementById('save-token-btn');
    const manualResultDiv = document.getElementById('manual-result');

    // 页面加载时自动检测当前 Token
    checkCurrentToken();

    // 刷新状态
    refreshStatusBtn.addEventListener('click', checkCurrentToken);

    // 清除 Token
    clearTokenBtn.addEventListener('click', () => {
        clearGitHubToken();
        updateStatusPanel(false, null, '已清除');
        showMessage(manualResultDiv, '本地 Token 已清除', 'info');
    });

    // 卡密获取并测试
    fetchTokenBtn.addEventListener('click', async () => {
        const key = keyInput.value.trim();
        if (!key) {
            showMessage(keyResultDiv, '请输入卡密', 'error');
            return;
        }
        showMessage(keyResultDiv, '正在获取 Token...', 'info');
        try {
            const response = await fetch(`http://balls.xhzx.qzz.io/key/${encodeURIComponent(key)}`);
            if (!response.ok) {
                throw new Error(`卡密无效 (HTTP ${response.status})`);
            }
            const token = (await response.text()).trim();
            if (!token) {
                throw new Error('返回的 Token 为空');
            }
            // 保存到 Cookie
            setCookie('github_token', token, 7);
            showMessage(keyResultDiv, 'Token 获取成功，正在验证...', 'success');
            // 验证 Token
            const isValid = await testToken(token);
            if (isValid) {
                updateStatusPanel(true, token);
                showMessage(keyResultDiv, `✅ Token 有效！已保存并激活。`, 'success');
            } else {
                updateStatusPanel(false, token);
                showMessage(keyResultDiv, `⚠️ Token 已保存但验证失败，请检查权限。`, 'error');
            }
        } catch (error) {
            console.error('获取 Token 失败:', error);
            showMessage(keyResultDiv, `❌ 获取失败: ${error.message}`, 'error');
            updateStatusPanel(false);
        }
    });

    // 测试手动输入的 Token
    testTokenBtn.addEventListener('click', async () => {
        const token = tokenInput.value.trim();
        if (!token) {
            showMessage(manualResultDiv, '请输入 Token', 'error');
            return;
        }
        showMessage(manualResultDiv, '测试中...', 'info');
        const isValid = await testToken(token);
        if (isValid) {
            showMessage(manualResultDiv, '✅ Token 有效！', 'success');
        } else {
            showMessage(manualResultDiv, '❌ Token 无效，请检查权限或是否过期', 'error');
        }
    });

    // 保存手动 Token 到 Cookie 并测试
    saveTokenBtn.addEventListener('click', async () => {
        const token = tokenInput.value.trim();
        if (!token) {
            showMessage(manualResultDiv, '请输入 Token', 'error');
            return;
        }
        setCookie('github_token', token, 7);
        showMessage(manualResultDiv, 'Token 已保存，正在验证...', 'info');
        const isValid = await testToken(token);
        if (isValid) {
            updateStatusPanel(true, token);
            showMessage(manualResultDiv, '✅ Token 有效！已保存并激活。', 'success');
        } else {
            updateStatusPanel(false, token);
            showMessage(manualResultDiv, '⚠️ Token 已保存但验证失败。', 'error');
        }
    });

    // ----- 辅助函数 -----
    function showMessage(element, text, type) {
        element.textContent = text;
        element.className = `message ${type}`;
        element.style.display = 'block';
    }

    // 检测当前 Cookie 中的 Token
    async function checkCurrentToken() {
        const token = getCookie('github_token');
        if (!token) {
            cookieStatusSpan.textContent = '未找到';
            tokenValiditySpan.textContent = '无 Token';
            githubUserSpan.textContent = '—';
            rateLimitSpan.textContent = '—';
            return;
        }
        cookieStatusSpan.textContent = '已存在 (部分隐藏: ' + token.substring(0, 8) + '...)';
        const isValid = await testToken(token);
        updateStatusPanel(isValid, token);
    }

    // 更新状态面板
    function updateStatusPanel(isValid, token, customMessage) {
        if (isValid === false) {
            tokenValiditySpan.innerHTML = '<span style="color: #dc2626;">❌ 无效</span>';
            githubUserSpan.textContent = '—';
            rateLimitSpan.textContent = '—';
            return;
        }
        if (isValid === true && token) {
            // 在 testToken 中已经更新了用户信息和速率限制，此处由 testToken 内部更新
            // 我们在这里只做样式
        } else {
            // 无 token 状态
            tokenValiditySpan.textContent = customMessage || '未检测';
        }
    }

    // 核心测试函数：调用 GitHub API /user
    async function testToken(token) {
        try {
            const response = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            // 同时获取速率限制信息
            const rateResponse = await fetch('https://api.github.com/rate_limit', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) {
                console.warn('Token 验证失败, HTTP', response.status);
                tokenValiditySpan.innerHTML = '<span style="color: #dc2626;">❌ 无效 (HTTP ' + response.status + ')</span>';
                githubUserSpan.textContent = '—';
                rateLimitSpan.textContent = '—';
                return false;
            }
            
            const userData = await response.json();
            const rateData = await rateResponse.json();
            
            // 更新状态面板
            tokenValiditySpan.innerHTML = '<span style="color: #16a34a;">✅ 有效</span>';
            githubUserSpan.textContent = userData.login + (userData.name ? ` (${userData.name})` : '');
            
            const core = rateData.resources.core;
            rateLimitSpan.textContent = `${core.remaining} / ${core.limit} (重置: ${new Date(core.reset * 1000).toLocaleTimeString()})`;
            
            cookieStatusSpan.textContent = '已存在 (部分隐藏: ' + token.substring(0, 8) + '...)';
            
            return true;
        } catch (error) {
            console.error('测试 Token 网络错误:', error);
            tokenValiditySpan.innerHTML = '<span style="color: #dc2626;">❌ 网络错误</span>';
            githubUserSpan.textContent = '—';
            rateLimitSpan.textContent = '—';
            return false;
        }
    }

    // 将 testToken 挂载到 window 以便外部调用（可选）
    window.testToken = testToken;
});