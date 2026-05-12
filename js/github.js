const GITHUB_OWNER = "github-xiaoli";
const GITHUB_REPO = "xhzx";
const API_BASE = "https://api.github.com";

// --- Cookie 工具 ---
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}
function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + days * 86400000);
    document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/;SameSite=Lax`;
}
function deleteCookie(name) {
    setCookie(name, "", -1);
}

// --- 认证状态与跳转 ---
function getToken() {
    return getCookie("github_token");
}
function getAdminId() {
    return getCookie("admin_id");
}
function requireAuth() {
    if (!getToken() || !getAdminId()) {
        const currentPage = window.location.pathname.split('/').pop();
        window.location.href = `login.html?redirect=${encodeURIComponent(currentPage)}`;
        return false;
    }
    return true;
}
function clearAuth() {
    deleteCookie("github_token");
    deleteCookie("admin_id");
}

// --- Base64 解码（UTF-8） ---
function decodeBase64Content(base64content) {
    const binary = atob(base64content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
}

// --- GitHub API 封装 ---
async function githubGet(path) {
    const url = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
    const headers = {};
    const token = getToken();
    if (token) headers["Authorization"] = `token ${token}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
        if (resp.status === 403 || resp.status === 429) {
            const errData = await resp.json().catch(() => ({}));
            if (errData.message && errData.message.includes("rate limit")) {
                throw new Error("API 速率限制已耗尽，请稍后再试。");
            }
            throw new Error(`请求失败 (${resp.status}): 权限不足或触发限制`);
        }
        if (resp.status === 404) return null;
        throw new Error(`读取 ${path} 失败 (${resp.status})`);
    }
    return await resp.json();
}

async function githubPut(path, contentBase64, message, token, sha = null) {
    const url = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
    const body = { message, content: contentBase64, branch: "main" };
    if (sha) body.sha = sha;
    const resp = await fetch(url, {
        method: "PUT",
        headers: {
            "Authorization": `token ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`写入 ${path} 失败 (${resp.status}): ${err.message || ''}`);
    }
    return await resp.json();
}

async function githubDelete(path, sha, token) {
    const url = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
    const resp = await fetch(url, {
        method: "DELETE",
        headers: {
            "Authorization": `token ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ message: `Delete ${path}`, sha, branch: "main" })
    });
    if (!resp.ok) throw new Error(`删除 ${path} 失败 (${resp.status})`);
    return await resp.json();
}

async function listDirectories(path) {
    const data = await githubGet(path);
    if (!data || !Array.isArray(data)) return [];
    return data.filter(item => item.type === "dir").map(item => item.name);
}

async function listFiles(path) {
    const data = await githubGet(path);
    if (!data || !Array.isArray(data)) return [];
    return data.filter(item => item.type === "file").map(item => item.name);
}

function generateTimestamp() {
    const now = new Date();
    return (
        now.getUTCFullYear() +
        String(now.getUTCMonth() + 1).padStart(2, '0') +
        String(now.getUTCDate()).padStart(2, '0') +
        String(now.getUTCHours()).padStart(2, '0') +
        String(now.getUTCMinutes()).padStart(2, '0') +
        String(now.getUTCSeconds()).padStart(2, '0') +
        String(now.getUTCMilliseconds()).padStart(3, '0')
    );
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ========== 下载函数（兼容 WebView / APK） ==========

// 构建 Basic Auth URL（Token 作为密码）
function buildBasicAuthUrl(originalUrl) {
    const token = getToken();
    if (!token) throw new Error("未登录");
    // 使用 x-access-token 作为用户名（GitHub 忽略用户名，仅验证密码）
    const urlObj = new URL(originalUrl);
    urlObj.username = 'x-access-token';
    urlObj.password = token;
    return urlObj.toString();
}

// 通用下载触发函数
function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || '';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }, 100);
}

// 1. 下载整个仓库 ZIP（备份）
async function downloadRepoZip() {
    const token = getToken();
    if (!token) throw new Error("未登录");

    const apiUrl = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/zipball/main`;

    // 方案 A：标准 fetch（需 CORS 支持）
    try {
        const resp = await fetch(apiUrl, {
            headers: { Authorization: `token ${token}` },
            redirect: 'follow'
        });
        if (!resp.ok) throw new Error('status ' + resp.status);
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        triggerDownload(blobUrl, `${GITHUB_REPO}_backup.zip`);
        return;
    } catch (e) {
        console.warn('fetch 下载仓库失败，回退到 Basic Auth URL', e);
        // 方案 B：使用 Basic Auth URL 直接触发下载
        const basicUrl = buildBasicAuthUrl(apiUrl);
        triggerDownload(basicUrl, `${GITHUB_REPO}_backup.zip`);
    }
}

// 2. 下载单个文件
async function downloadSingleFile(filePath) {
    const token = getToken();
    if (!token) throw new Error("未登录");

    const apiUrl = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;

    // 尝试先获取文件元数据（以得到正确的文件名和内容）
    try {
        const data = await githubGet(filePath);
        if (!data) throw new Error("文件不存在");

        // 使用 download_url 并通过 Basic Auth 获取原始内容
        const downloadUrl = data.download_url;
        if (downloadUrl) {
            // 直接通过 Basic Auth URL 下载原始内容（避免 fetch 跨域）
            const basicRawUrl = buildBasicAuthUrl(downloadUrl);
            triggerDownload(basicRawUrl, data.name);  // 强制使用原始文件名
            return;
        }
    } catch (fetchErr) {
        console.warn('获取文件元数据失败，尝试拼接 raw URL', fetchErr);
    }

    // 回退：拼接 raw.githubusercontent.com 路径（假设文件在 main 分支）
    const assumedRawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${filePath}`;
    const basicUrl = buildBasicAuthUrl(assumedRawUrl);
    const filename = filePath.split('/').pop() || 'file';
    triggerDownload(basicUrl, filename);
}

// 3. 下载文件夹为 ZIP
async function downloadFolderAsZip(folderPath) {
    if (typeof JSZip === 'undefined') {
        alert("当前环境不支持打包文件夹，请下载整个仓库备份。");
        return;
    }

    // 尝试用 JSZip 在前端打包
    try {
        const zip = new JSZip();
        async function addToZip(dirPath, zipFolder) {
            const entries = await githubGet(dirPath);
            if (!entries || !Array.isArray(entries)) return;
            for (const entry of entries) {
                const fullPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
                if (entry.type === 'file') {
                    const fileData = await githubGet(fullPath);
                    if (fileData) {
                        const byteChars = atob(fileData.content);
                        const bytes = new Uint8Array(byteChars.length);
                        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
                        zipFolder.file(entry.name, bytes);
                    }
                } else if (entry.type === 'dir') {
                    const subFolder = zipFolder.folder(entry.name);
                    if (subFolder) await addToZip(fullPath, subFolder);
                }
            }
        }
        const rootFolder = zip.folder(folderPath.split('/').pop() || 'root');
        if (rootFolder) await addToZip(folderPath, rootFolder);
        const blob = await zip.generateAsync({ type: "blob" });
        const blobUrl = URL.createObjectURL(blob);
        triggerDownload(blobUrl, (folderPath.split('/').pop() || 'folder') + '.zip');
    } catch (e) {
        console.error('打包文件夹失败，回退到下载整个仓库', e);
        await downloadRepoZip();
    }
}

// 验证 Token 有效性
async function fetchUserInfo(token) {
    try {
        const resp = await fetch(`${API_BASE}/user`, {
            headers: { "Authorization": `token ${token}` }
        });
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        throw e;
    }
}
// 安全 UTF-8 转 Base64（避免 btoa 报错）
function utf8ToBase64(str) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    let binary = '';
    bytes.forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary);
}

// 从 Base64 安全解码（TextDecoder 已存在，无需额外添加）
// 可增加一个辅助函数 textToBase64 别名，略。

function utf8ToBase64(str) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    let binary = '';
    bytes.forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary);
}