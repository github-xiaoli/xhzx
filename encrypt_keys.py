import os
import base64
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

# 32 字节密钥，必须与前端 js/github.js 中的 ENCRYPTION_KEY 完全一致
KEY = b"aes256keyforgithub2026secret!!12"

def encrypt_token(plain_token: str) -> str:
    iv = os.urandom(16)
    cipher = AES.new(KEY, AES.MODE_CBC, iv)
    ct_bytes = cipher.encrypt(pad(plain_token.encode("utf-8"), AES.block_size))
    iv_b64 = base64.b64encode(iv).decode("utf-8")
    ct_b64 = base64.b64encode(ct_bytes).decode("utf-8")
    return f"{iv_b64}:{ct_b64}"

def main():
    print("=== GitHub API 密钥加密工具 ===")
    card = input("请输入卡密（文件名）: ").strip()
    if not card:
        print("❌ 卡密不能为空")
        return

    token = input("请输入明文 GitHub API 密钥: ").strip()
    if not token:
        print("❌ 密钥不能为空")
        return

    encrypted = encrypt_token(token)
    key_dir = "key"
    os.makedirs(key_dir, exist_ok=True)
    filepath = os.path.join(key_dir, card)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(encrypted)

    print(f"✔ 密文已成功写入 {filepath}")

if __name__ == "__main__":
    main()