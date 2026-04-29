import os
import base64
import hashlib
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

SALT = b"xhzx_salt"
KEY_LENGTH = 32  # AES-256

def derive_key(password: str) -> bytes:
    return hashlib.pbkdf2_hmac('sha1', password.encode('utf-8'), SALT, 1000, dklen=KEY_LENGTH)

def encrypt_token(plain_token: str, password: str) -> str:
    key = derive_key(password)
    iv = os.urandom(16)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    ct_bytes = cipher.encrypt(pad(plain_token.encode("utf-8"), AES.block_size))
    iv_b64 = base64.b64encode(iv).decode("utf-8")
    ct_b64 = base64.b64encode(ct_bytes).decode("utf-8")
    return f"{iv_b64}:{ct_b64}"

def main():
    print("=== 管理员 GitHub Token 加密工具（兼容版） ===")
    admin_id = input("管理员 ID: ").strip()
    if not admin_id:
        return
    password = input("卡密（至少8位）: ").strip()
    if len(password) < 8:
        print("❌ 卡密太短")
        return
    token = input("明文 GitHub Token: ").strip()
    if not token:
        return

    encrypted = encrypt_token(token, password)
    key_dir = os.path.join("member", "admin_info", admin_id)
    os.makedirs(key_dir, exist_ok=True)
    filepath = os.path.join(key_dir, "key")

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(encrypted)

    print(f"✔ 密文已写入 {filepath}")

if __name__ == "__main__":
    main()
