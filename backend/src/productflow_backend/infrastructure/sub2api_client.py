from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from productflow_backend.config import get_settings


@dataclass(slots=True)
class Sub2APIError(Exception):
    status_code: int
    code: str
    message: str


class Sub2APIClient:
    def __init__(self, timeout_seconds: float = 60):
        self.timeout = httpx.Timeout(timeout_seconds, connect=20)

    async def public_settings(self) -> dict[str, Any]:
        return await self._request("GET", "/api/v1/settings/public")

    async def send_verify_code(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/v1/auth/send-verify-code", json=payload)

    async def register(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/v1/auth/register", json=payload)

    async def login(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/v1/auth/login", json=payload)

    async def login_2fa(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/v1/auth/login/2fa", json=payload)

    async def list_keys(self, access_token: str) -> list[dict[str, Any]]:
        data = await self._request(
            "GET",
            "/api/v1/keys?page=1&page_size=100&sort_by=created_at&sort_order=desc",
            access_token=access_token,
        )
        if isinstance(data, dict) and isinstance(data.get("items"), list):
            return [item for item in data["items"] if isinstance(item, dict)]
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        return []

    async def list_available_groups(self, access_token: str) -> list[dict[str, Any]]:
        data = await self._request("GET", "/api/v1/groups/available", access_token=access_token)
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        return []

    async def create_key(self, access_token: str, payload: dict[str, Any]) -> dict[str, Any]:
        data = await self._request("POST", "/api/v1/keys", json=payload, access_token=access_token)
        if not isinstance(data, dict):
            raise Sub2APIError(502, "API_KEY_UNAVAILABLE", "sub2api 返回的 API Key 数据格式不正确")
        return data

    async def list_usage(self, access_token: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        data = await self._request("GET", "/api/v1/usage", params=params or {}, access_token=access_token)
        if isinstance(data, dict):
            return data
        if isinstance(data, list):
            return {"items": data}
        return {}

    async def _request(
        self,
        method: str,
        path: str,
        *,
        access_token: str | None = None,
        **kwargs: Any,
    ) -> Any:
        base_url = get_settings().sub2api_auth_base_url
        if not base_url:
            raise Sub2APIError(503, "SUB2API_UNAVAILABLE", "sub2api 认证服务未配置")
        url = f"{base_url.rstrip('/')}/{path.lstrip('/')}"
        headers = kwargs.pop("headers", {})
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
                response = await client.request(method, url, headers=headers, **kwargs)
        except httpx.RequestError as exc:
            raise Sub2APIError(502, "SUB2API_UNAVAILABLE", "无法连接 sub2api 服务") from exc

        payload = _safe_json(response)
        if response.status_code >= 400:
            raise Sub2APIError(response.status_code, _error_code(response.status_code, payload), _error_message(payload, response))
        if isinstance(payload, dict) and payload.get("code") not in (None, 0):
            raise Sub2APIError(response.status_code, _error_code(response.status_code, payload), _error_message(payload, response))
        if isinstance(payload, dict) and "data" in payload:
            return payload["data"]
        return payload


def get_sub2api_client() -> Sub2APIClient:
    return Sub2APIClient()


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return response.text[:500]


def _error_code(status_code: int, payload: Any) -> str:
    if status_code in {401, 403}:
        return "INVALID_CREDENTIALS"
    if isinstance(payload, dict):
        raw = payload.get("code") or payload.get("error")
        if isinstance(raw, str):
            lowered = raw.lower()
            if "verify" in lowered:
                return "VERIFY_CODE_INVALID"
            if "registration" in lowered:
                return "REGISTRATION_DISABLED"
            if "2fa" in lowered or "totp" in lowered:
                return "REQUIRES_2FA"
    return "SUB2API_UNAVAILABLE" if status_code >= 500 else "INVALID_CREDENTIALS"


def _error_message(payload: Any, response: httpx.Response) -> str:
    if isinstance(payload, dict):
        for key in ("message", "reason", "detail"):
            value = payload.get(key)
            if value:
                return str(value)
        error = payload.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if error:
            return str(error)
    return response.text[:500] or f"sub2api returned HTTP {response.status_code}"
