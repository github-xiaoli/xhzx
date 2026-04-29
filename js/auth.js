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
/**
 * 登录流程（增加网络容错）
 */
async function performLogin(adminId, password, redirectPage) {
    // 1. 获取加密文件
    const resp = await fetch(`/member/admin_info/${adminId}/key`);
    if (!resp.ok) throw new Error("管理员 ID 不存在或无 key 文件");
    const encrypted = await resp.text();

    // 2. 解密
    const token = await decryptTokenWithPassword(encrypted, password);

    // 3. 验证 token 可用性（多级容错）
    let tokenValid = false;
    try {
        // 方案 A：尝试调用 /user（最直接）
        const user = await fetchUserInfo(token);
        if (user) tokenValid = true;
    } catch (e) {
        console.warn("[/user] 请求失败，尝试备用验证…", e.message);
    }

    if (!tokenValid) {
        try {
            // 方案 B：尝试读取仓库根目录（只需 repo 权限）
            const repoTest = await githubGet("");  // 空字符串表示根目录
            if (repoTest) tokenValid = true;
        } catch (e) {
            console.warn("[/repo] 请求也失败", e.message);
        }
    }

    if (!tokenValid) {
        // 方案 C：完全信任解密结果（因为解密成功卡密正确）
        console.warn("⚠️ 无法验证 Token 权限，将直接登录（可能部分功能受限）");
        // 但仍允许登录，只要解密成功
    }

    // 4. 存储 cookie
    setCookie("github_token", token, 7);
    setCookie("admin_id", adminId, 7);

    // 5. 跳转
    window.location.href = redirectPage || "backend.html";
}

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