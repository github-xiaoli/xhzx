import os
import base64
import argparse
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

# 32 字节密钥，必须与前端 ENCRYPTION_KEY 完全一致
KEY = b"aes256keyforgithub2026secret!!12"

def encrypt_token(plain_token: str) -> str:
    iv = os.urandom(16)
    cipher = AES.new(KEY, AES.MODE_CBC, iv)
    ct_bytes = cipher.encrypt(pad(plain_token.encode("utf-8"), AES.block_size))
    iv_b64 = base64.b64encode(iv).decode("utf-8")
    ct_b64 = base64.b64encode(ct_bytes).decode("utf-8")
    return f"{iv_b64}:{ct_b64}"

def main():
    parser = argparse.ArgumentParser(description="加密 GitHub API 密钥并写入 key/卡密 文件")
    parser.add_argument("--card", required=True, help="卡密（即文件名）")
    parser.add_argument("--token", required=True, help="明文 GitHub API 密钥")
    args = parser.parse_args()

    encrypted = encrypt_token(args.token)
    key_dir = "key"
    os.makedirs(key_dir, exist_ok=True)
    filepath = os.path.join(key_dir, args.card)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(encrypted)
    print(f"✔ 密文已写入 {filepath}")

if __name__ == "__main__":
    main()