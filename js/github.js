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

// --- GitHub API 封装（自动携带 Token） ---
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

// --- 下载仓库 ZIP（修复重定向丢失认证） ---
async function downloadRepoZip() {
    const token = getToken();
    if (!token) throw new Error("未登录");
    const url = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/zipball/main`;
    const resp = await fetch(url, {
        headers: { Authorization: `token ${token}` },
        redirect: 'manual'
    });
    let downloadUrl;
    if (resp.status === 302) {
        downloadUrl = resp.headers.get('Location');
        if (!downloadUrl) throw new Error("获取下载地址失败");
    } else if (resp.status === 200) {
        downloadUrl = url;
    } else {
        throw new Error(`下载请求失败 (${resp.status})`);
    }
    const blobResp = await fetch(downloadUrl);
    if (!blobResp.ok) throw new Error("下载文件失败");
    const blob = await blobResp.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${GITHUB_REPO}_backup.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
}

// --- 下载单个文件（将 Base64 内容转为 Blob 下载） ---
async function downloadSingleFile(filePath) {
    const data = await githubGet(filePath);
    if (!data) throw new Error("文件不存在");
    const byteChars = atob(data.content);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
        bytes[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = data.name;
    link.click();
    URL.revokeObjectURL(link.href);
}

// --- 递归下载文件夹为 ZIP（依赖 JSZip 库） ---
async function downloadFolderAsZip(folderPath) {
    if (typeof JSZip === 'undefined') throw new Error("缺少 JSZip 库，无法打包文件夹");
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
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (folderPath.split('/').pop() || 'folder') + '.zip';
    link.click();
    URL.revokeObjectURL(link.href);
}

// 验证 Token 有效性（备用）
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