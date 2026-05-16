from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from productflow_backend.infrastructure.credential_vault import get_credential_vault
from productflow_backend.infrastructure.db.models import AuthSession
from productflow_backend.infrastructure.sub2api_client import Sub2APIClient, Sub2APIError, get_sub2api_client
from productflow_backend.presentation.deps import CurrentUser, get_current_user, get_session

router = APIRouter(prefix="/api", tags=["account"])


@router.get("/account")
def get_account(current_user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return {
        "user": {
            "owner_id": current_user.owner_id,
            "sub2api_user_id": current_user.sub2api_user_id,
            "email": current_user.email,
            "username": current_user.username,
            "role": current_user.role,
            "authenticated": True,
            "api_key_source": "sub2api" if current_user.credential_id else "none",
            "api_key_status": "available" if current_user.credential_id else "API_KEY_UNAVAILABLE",
            "provider_key_fingerprint": current_user.provider_key_fingerprint,
        },
        "balance": {"ok": False, "remaining": None, "message": "余额尚未查询"},
    }


@router.get("/account/balance")
async def get_balance(
    current_user: CurrentUser = Depends(get_current_user),
    session: Session = Depends(get_session),
    auth_client: Sub2APIClient = Depends(get_sub2api_client),
) -> dict[str, Any]:
    auth_session = session.get(AuthSession, current_user.session_id)
    if auth_session is None or not auth_session.encrypted_access_token:
        raise HTTPException(status_code=401, detail={"code": "SESSION_EXPIRED", "message": "登录已过期，请重新登录"})
    try:
        access_token = get_credential_vault().decrypt(auth_session.encrypted_access_token)
        data = await auth_client.list_usage(access_token)
    except Sub2APIError as exc:
        if exc.status_code in {401, 403}:
            session.delete(auth_session)
            session.commit()
            raise HTTPException(status_code=401, detail={"code": "SESSION_EXPIRED", "message": "登录已过期，请重新登录"}) from exc
        return {"ok": False, "remaining": None, "message": exc.message}

    auth_session.last_seen_at = datetime.now(UTC)
    session.commit()
    return _balance_summary(data)


def _balance_summary(data: dict[str, Any]) -> dict[str, Any]:
    items = data.get("items") if isinstance(data.get("items"), list) else []
    first_item = items[0] if items and isinstance(items[0], dict) else {}
    user = first_item.get("user") if isinstance(first_item.get("user"), dict) else {}
    api_key = first_item.get("api_key") if isinstance(first_item.get("api_key"), dict) else {}

    remaining = data.get("remaining")
    if remaining is None:
        remaining = data.get("balance")
    if remaining is None and isinstance(data.get("summary"), dict):
        remaining = data["summary"].get("remaining") or data["summary"].get("balance")
    if remaining is None:
        remaining = user.get("balance")

    try:
        remaining_value = None if remaining is None else float(remaining)
    except (TypeError, ValueError):
        remaining_value = None

    return {
        "ok": bool(data),
        "remaining": remaining_value,
        "message": data.get("message"),
        "usage": {
            "request_count": len(items),
            "total_cost": _sum_usage_field(items, "total_cost"),
            "actual_cost": _sum_usage_field(items, "actual_cost"),
            "api_key_quota": api_key.get("quota"),
            "api_key_quota_used": api_key.get("quota_used"),
            "last_active_at": user.get("last_active_at"),
        },
    }


def _sum_usage_field(items: list[Any], field: str) -> float:
    total = 0.0
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            total += float(item.get(field) or 0)
        except (TypeError, ValueError):
            continue
    return total
