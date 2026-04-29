// ===================== 认证与解密模块 =====================
// 使用浏览器原生 Web Crypto API，与 Python hashlib 完全等价

// --- 工具函数 ---
function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// 字符串 → Uint8Array
function stringToUint8Array(str) {
    return new TextEncoder().encode(str);
}

// PBKDF2 派生密钥（SHA‑1、1000次、256 位）
async function deriveKeyWebCrypto(password) {
    const passwordBuffer = stringToUint8Array(password);
    const salt = stringToUint8Array("xhzx_salt");
    const keyMaterial = await crypto.subtle.importKey(
        "raw", passwordBuffer, "PBKDF2", false, ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 1000,
            hash: "SHA-1"
        },
        keyMaterial,
        256
    );
    return await crypto.subtle.importKey(
        "raw", derivedBits, "AES-CBC", false, ["decrypt", "encrypt"]
    );
}

// AES‑CBC 解密
async function decryptWithWebCrypto(key, ivB64, ctB64) {
    const iv = base64ToArrayBuffer(ivB64);
    const ct = base64ToArrayBuffer(ctB64);
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: iv },
        key,
        ct
    );
    return new TextDecoder().decode(decrypted);
}

// AES‑CBC 加密（用于修改卡密时生成新密文）
async function encryptWithWebCrypto(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const data = new TextEncoder().encode(plaintext);
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-CBC", iv: iv },
        key,
        data
    );
    const ivB64 = btoa(String.fromCharCode(...iv));
    const ctB64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
    return `${ivB64}:${ctB64}`;
}

// --- 对外接口 ---

/**
 * 解密 token
 * @param {string} encrypted - 格式: iv:ct
 * @param {string} password - 卡密
 * @returns {Promise<string>} 明文 token
 */
async function decryptTokenWithPassword(encrypted, password) {
    const trimmed = encrypted.trim();  // 防御换行/空格
    const parts = trimmed.split(":");
    if (parts.length !== 2) throw new Error("密文格式错误");
    const key = await deriveKeyWebCrypto(password);
    const token = await decryptWithWebCrypto(key, parts[0], parts[1]);
    if (!token || token.length === 0) throw new Error("解密结果为空，卡密可能错误");
    return token;
}

/**
 * 登录流程
 * @param {string} adminId
 * @param {string} password
 * @param {string} redirectPage
 */
async function performLogin(adminId, password, redirectPage) {
    // 1. 获取加密文件
    const resp = await fetch(`/member/admin_info/${adminId}/key`);
    if (!resp.ok) throw new Error("管理员 ID 不存在或无 key 文件");
    const encrypted = await resp.text();

    // 2. 解密
    const token = await decryptTokenWithPassword(encrypted, password);

    // 3. 验证 token 有效性
    const user = await fetchUserInfo(token);
    if (!user) throw new Error("Token 无效，无法访问 GitHub");

    // 4. 存储 cookie
    setCookie("github_token", token, 7);
    setCookie("admin_id", adminId, 7);

    // 5. 跳转
    window.location.href = redirectPage || "backend.html";
}

/**
 * 修改卡密
 */
async function changePassword(adminId, oldPassword, newPassword) {
    // 读取原密文
    const resp = await fetch(`/member/admin_info/${adminId}/key`);
    if (!resp.ok) throw new Error("无法读取 key 文件");
    const encrypted = await resp.text();

    // 解密得到原始 token
    const token = await decryptTokenWithPassword(encrypted, oldPassword);

    // 用新卡密加密 token
    const newEncrypted = await encryptWithWebCrypto(await deriveKeyWebCrypto(newPassword), token);

    // 写入仓库（需要当前登录的 token，从 cookie 获取）
    const currentToken = getToken();
    if (!currentToken) throw new Error("登录已过期，请重新登录后再修改");

    const b64Content = btoa(unescape(encodeURIComponent(newEncrypted)));
    const existing = await githubGet(`member/admin_info/${adminId}/key`);
    await githubPut(
        `member/admin_info/${adminId}/key`,
        b64Content,
        `Change password for admin ${adminId}`,
        currentToken,
        existing ? existing.sha : null
    );

    return true;
}