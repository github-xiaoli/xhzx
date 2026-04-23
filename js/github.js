const GITHUB_OWNER = "github-xiaoli";
const GITHUB_REPO = "xhzx";
const API_BASE = "https://api.github.com";
const ENCRYPTION_KEY = "aes256keyforgithub2026secret!!12"; // 必须与 Python 脚本完全一致

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

// --- 获取并解密 Token，并缓存卡密 ---
async function fetchEncryptedKey(card) {
    const resp = await fetch(`http://balls.xhzx.qzz.io/key/${card}`);
    if (!resp.ok) throw new Error("卡密无效或网络错误");
    return await resp.text();
}

function decryptToken(encrypted) {
    const parts = encrypted.split(":");
    if (parts.length !== 2) throw new Error("密文格式错误");
    const iv = CryptoJS.enc.Base64.parse(parts[0]);
    const ciphertext = parts[1];
    const key = CryptoJS.enc.Utf8.parse(ENCRYPTION_KEY);
    const decrypted = CryptoJS.AES.decrypt(ciphertext, key, { iv: iv });
    return decrypted.toString(CryptoJS.enc.Utf8);
}

async function getGitHubToken() {
    // 优先从 Cookie 中读取
    let token = getCookie("github_token");
    if (token) return token;

    // 无 Cookie，弹出卡密输入框
    const card = prompt("请输入卡密以获取操作权限：");
    if (!card) throw new Error("未提供卡密");
    const encrypted = await fetchEncryptedKey(card);
    token = decryptToken(encrypted);
    if (!token) throw new Error("解密失败，请检查卡密是否正确");
    setCookie("github_token", token, 7);   // 7 天有效
    setCookie("card_key", card, 7);       // 同时缓存卡密
    return token;
}

// 清除所有认证 Cookie
function clearAuthCookies() {
    deleteCookie("github_token");
    deleteCookie("card_key");
    console.log("认证信息已清除");
}

// 从 Cookie 获取缓存的卡密（可能不存在）
function getCachedCard() {
    return getCookie("card_key") || "";
}

// --- GitHub API 基础封装（保持不变） ---
async function githubGet(path) {
    const url = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
    const resp = await fetch(url);
    if (!resp.ok) {
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