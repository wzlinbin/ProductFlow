from __future__ import annotations

import base64
import hashlib
import os
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from productflow_backend.config import get_settings

_VERSION = "v1"
_NONCE_BYTES = 12
_KEY_BYTES = 32


class CredentialVaultError(ValueError):
    pass


class CredentialVault:
    def __init__(self, key_material: str):
        self._key = _derive_key(key_material)

    def encrypt(self, plaintext: str) -> str:
        if plaintext == "":
            raise CredentialVaultError("凭据内容不能为空")
        nonce = os.urandom(_NONCE_BYTES)
        ciphertext = AESGCM(self._key).encrypt(nonce, plaintext.encode("utf-8"), _VERSION.encode("ascii"))
        return f"{_VERSION}.{_b64(nonce + ciphertext)}"

    def decrypt(self, value: str) -> str:
        try:
            version, encoded = value.split(".", 1)
        except ValueError as exc:
            raise CredentialVaultError("凭据密文格式不正确") from exc
        if version != _VERSION:
            raise CredentialVaultError("凭据密文版本不支持")
        payload = _unb64(encoded)
        if len(payload) <= _NONCE_BYTES:
            raise CredentialVaultError("凭据密文内容不完整")
        nonce = payload[:_NONCE_BYTES]
        ciphertext = payload[_NONCE_BYTES:]
        try:
            plaintext = AESGCM(self._key).decrypt(nonce, ciphertext, version.encode("ascii"))
        except Exception as exc:
            raise CredentialVaultError("凭据解密失败") from exc
        return plaintext.decode("utf-8")


@lru_cache(maxsize=1)
def get_credential_vault() -> CredentialVault:
    return CredentialVault(get_settings().credential_vault_key)


def fingerprint_secret(secret: str) -> str:
    digest = hashlib.sha256(secret.encode("utf-8")).hexdigest()
    return digest[:16]


def _derive_key(key_material: str) -> bytes:
    raw = key_material.strip()
    if len(raw) < 32:
        raise CredentialVaultError("CREDENTIAL_VAULT_KEY 长度不足")
    decoded = _try_decode_key(raw)
    if decoded is not None:
        if len(decoded) != _KEY_BYTES:
            raise CredentialVaultError("CREDENTIAL_VAULT_KEY 解码后必须为 32 字节")
        return decoded
    return hashlib.sha256(raw.encode("utf-8")).digest()


def _try_decode_key(value: str) -> bytes | None:
    try:
        return base64.urlsafe_b64decode(_pad_b64(value))
    except Exception:
        return None


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(_pad_b64(value))


def _pad_b64(value: str) -> str:
    return value + "=" * (-len(value) % 4)
