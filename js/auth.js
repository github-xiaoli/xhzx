// PBKDF2 盐（与 Python 一致）
const PBKDF2_SALT = "xhzx_salt";
const KEY_SIZE = 32; // 256 bit

function deriveKey(password) {
    const salt = CryptoJS.enc.Utf8.parse(PBKDF2_SALT);
    const key = CryptoJS.PBKDF2(password, salt, {
        keySize: KEY_SIZE / 4, // words
        iterations: 1000
    });
    return key;
}

function decryptTokenWithPassword(encrypted, password) {
    const parts = encrypted.split(":");
    if (parts.length !== 2) throw new Error("密文格式错误");
    const iv = CryptoJS.enc.Base64.parse(parts[0]);
    const ciphertext = parts[1];
    const key = deriveKey(password);
    const decrypted = CryptoJS.AES.decrypt(ciphertext, key, { iv: iv });
    return decrypted.toString(CryptoJS.enc.Utf8);
}

// 登录流程
async function performLogin(adminId, password, redirectPage) {
    // 1. 读取加密文件
    const resp = await fetch(`/member/admin_info/${adminId}/key`);
    if (!resp.ok) throw new Error("管理员 ID 不存在或无 key 文件");
    const encrypted = await resp.text();

    // 2. 解密
    let token;
    try {
        token = decryptTokenWithPassword(encrypted, password);
    } catch (e) {
        throw new Error("卡密错误，解密失败");
    }
    if (!token) throw new Error("解密结果为空");

    // 3. 验证 token
    const user = await fetchUserInfo(token);
    if (!user) throw new Error("Token 无效，无法访问 GitHub");

    // 4. 存储 cookie
    setCookie("github_token", token, 7);
    setCookie("admin_id", adminId, 7);

    // 5. 跳转
    window.location.href = redirectPage || "backend.html";
}

// 修改卡密
async function changePassword(adminId, oldPassword, newPassword) {
    // 读取原 key
    const resp = await fetch(`/member/admin_info/${adminId}/key`);
    if (!resp.ok) throw new Error("无法读取 key 文件");
    const encrypted = await resp.text();

    // 解密
    const token = decryptTokenWithPassword(encrypted, oldPassword);
    if (!token) throw new Error("旧卡密错误");

    // 用新卡密加密
    const newKey = deriveKey(newPassword);
    const iv = CryptoJS.lib.WordArray.random(16);
    const encryptedNew = CryptoJS.AES.encrypt(token, newKey, { iv: iv });
    const ivB64 = CryptoJS.enc.Base64.stringify(iv);
    const ctB64 = encryptedNew.toString();
    const newEncrypted = `${ivB64}:${ctB64}`;

    // 上传
    const tokenForApi = getToken(); // 使用当前 cookie 中的 token 进行写入
    if (!tokenForApi) throw new Error("登录已过期，请重新登录后再修改");

    // 获取 sha（如果有）
    const existing = await githubGet(`member/admin_info/${adminId}/key`);
    const b64Content = btoa(unescape(encodeURIComponent(newEncrypted)));
    await githubPut(`member/admin_info/${adminId}/key`, b64Content,
        `Change password for admin ${adminId}`, tokenForApi, existing ? existing.sha : null);

    return true;
}

// 检查登录并跳转
function checkLoginAndRedirect() {
    if (!requireAuth()) { // requireAuth 内部会跳转
        throw new Error("未登录");
    }
}