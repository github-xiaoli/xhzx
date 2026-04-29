import os
import base64
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Util.Padding import pad

# PBKDF2 盐（与前端完全一致）
SALT = b"xhzx_salt"
KEY_LENGTH = 32  # AES-256

def derive_key(password: str) -> bytes:
    """使用 PBKDF2 从密码派生 AES 密钥"""
    return PBKDF2(password, SALT, dkLen=KEY_LENGTH, count=1000)

def encrypt_token(plain_token: str, password: str) -> str:
    """用密码加密 token，返回 'iv:密文' 格式的字符串"""
    key = derive_key(password)
    iv = os.urandom(16)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    ct_bytes = cipher.encrypt(pad(plain_token.encode("utf-8"), AES.block_size))
    iv_b64 = base64.b64encode(iv).decode("utf-8")
    ct_b64 = base64.b64encode(ct_bytes).decode("utf-8")
    return f"{iv_b64}:{ct_b64}"

def main():
    print("=== 管理员 GitHub Token 加密工具（PBKDF2）===")
    admin_id = input("请输入管理员 ID（如 admin01）: ").strip()
    if not admin_id:
        print("❌ ID 不能为空")
        return

    password = input("请输入卡密（用于加密/解密 token）: ").strip()
    if len(password) < 8:
        print("❌ 卡密长度至少 8 个字符")
        return

    token = input("请输入明文 GitHub API 密钥: ").strip()
    if not token:
        print("❌ 密钥不能为空")
        return

    encrypted = encrypt_token(token, password)
    # 目录：member/admin_info/<admin_id>/
    key_dir = os.path.join("member", "admin_info", admin_id)
    os.makedirs(key_dir, exist_ok=True)
    filepath = os.path.join(key_dir, "key")

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(encrypted)

    print(f"✔ 密文已成功写入 {filepath}")
    print("  请将整个 member/ 目录推送到 GitHub 仓库。")

if __name__ == "__main__":
    main()