// GitHub API 封装模块
const GITHUB_API_BASE = 'https://api.github.com';
const OWNER = 'github-xiaoli';
const REPO = 'xhzx';
const BRANCH = 'main';

// 获取 Cookie 中指定名称的值
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// 设置 Cookie
function setCookie(name, value, days = 7) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = `expires=${date.toUTCString()}`;
    document.cookie = `${name}=${value}; ${expires}; path=/; SameSite=Lax`;
}

// 删除 Cookie
function deleteCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

// 获取 GitHub API Token（从 Cookie 或通过卡密获取）
async function getGitHubToken() {
    // 先从 Cookie 读取
    let token = getCookie('github_token');
    if (token) {
        return token;
    }

    // 没有 Cookie，弹窗要求输入卡密
    const key = prompt('请输入卡密（密钥文件名称）以获取 GitHub 访问权限：');
    if (!key) {
        throw new Error('未提供卡密');
    }

    try {
        const response = await fetch(`http://balls.xhzx.qzz.io/key/${encodeURIComponent(key)}`);
        if (!response.ok) {
            throw new Error('卡密无效或网络错误');
        }
        token = await response.text();
        token = token.trim();
        if (!token) {
            throw new Error('卡密对应的令牌为空');
        }
        // 存入 Cookie
        setCookie('github_token', token, 7);
        return token;
    } catch (error) {
        console.error('获取 Token 失败:', error);
        throw new Error('卡密验证失败，请重试');
    }
}

// 清除存储的 Token（用于手动退出或切换）
function clearGitHubToken() {
    deleteCookie('github_token');
}

// 通用 GitHub API 请求函数
async function githubRequest(endpoint, options = {}) {
    const url = `${GITHUB_API_BASE}${endpoint}`;
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        ...options.headers
    };

    // 如果需要认证（写操作），获取并添加 Token
    if (options.requireAuth) {
        const token = await getGitHubToken();
        headers['Authorization'] = `Bearer ${token}`;
    }

    const fetchOptions = {
        method: options.method || 'GET',
        headers,
        ...options
    };
    delete fetchOptions.requireAuth; // 移除自定义字段

    if (options.body) {
        fetchOptions.body = JSON.stringify(options.body);
        if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }
    }

    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.message || `HTTP ${response.status}`;
        throw new Error(`GitHub API 错误: ${errorMsg}`);
    }

    return response.json();
}

// 读取文件内容（自动解码 Base64）
async function readFile(path) {
    const data = await githubRequest(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`);
    if (data.content) {
        const decoded = atob(data.content.replace(/\s/g, ''));
        return {
            content: decoded,
            sha: data.sha
        };
    }
    throw new Error('文件内容为空');
}

// 写入或更新文件
async function writeFile(path, content, commitMessage, requireAuth = true) {
    // 先尝试获取文件 SHA（如果存在则更新，否则创建）
    let sha = null;
    try {
        const existing = await githubRequest(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`);
        sha = existing.sha;
    } catch (error) {
        // 文件不存在，sha 为 null
    }

    const body = {
        message: commitMessage,
        content: btoa(unescape(encodeURIComponent(content))), // 支持 Unicode 的 Base64
        branch: BRANCH
    };
    if (sha) {
        body.sha = sha;
    }

    return githubRequest(`/repos/${OWNER}/${REPO}/contents/${path}`, {
        method: 'PUT',
        body,
        requireAuth
    });
}

// 上传二进制文件（如附件）
async function uploadFile(path, fileContentBase64, commitMessage, requireAuth = true) {
    let sha = null;
    try {
        const existing = await githubRequest(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`);
        sha = existing.sha;
    } catch (error) {
        // 不存在
    }

    const body = {
        message: commitMessage,
        content: fileContentBase64,
        branch: BRANCH
    };
    if (sha) {
        body.sha = sha;
    }

    return githubRequest(`/repos/${OWNER}/${REPO}/contents/${path}`, {
        method: 'PUT',
        body,
        requireAuth
    });
}

// 获取目录下所有文件列表
async function listDirectory(path) {
    const data = await githubRequest(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`);
    return Array.isArray(data) ? data : [];
}

// 检查文件是否存在
async function fileExists(path) {
    try {
        await githubRequest(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`);
        return true;
    } catch (error) {
        return false;
    }
}