from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from productflow_backend.config import get_runtime_settings
from productflow_backend.infrastructure.db.models import AuthSession
from productflow_backend.infrastructure.db.session import get_db_session

SESSION_COOKIE_NAME = "productflow_session"


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


@dataclass(frozen=True, slots=True)
class CurrentUser:
    session_id: str
    owner_id: str
    sub2api_user_id: str
    email: str | None
    username: str | None
    role: str
    credential_id: str | None
    api_key_id: str | None = None
    provider_key_fingerprint: str | None = None
    settings_unlocked_at: datetime | None = None

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def _dev_admin_user() -> CurrentUser:
    return CurrentUser(
        session_id="dev-session",
        owner_id="dev:admin",
        sub2api_user_id="dev-admin",
        email=None,
        username="dev-admin",
        role="admin",
        credential_id=None,
    )


def get_session(session: Session = Depends(get_db_session)) -> Session:
    return session


def get_current_user(request: Request, session: Session = Depends(get_session)) -> CurrentUser:
    access_required = get_runtime_settings().admin_access_required
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_id:
        if not access_required:
            return _dev_admin_user()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")

    auth_session = session.get(AuthSession, session_id)
    if auth_session is None:
        if not access_required:
            return _dev_admin_user()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")

    now = datetime.now(UTC)
    if as_utc(auth_session.expires_at) <= now:
        session.delete(auth_session)
        session.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期，请重新登录")

    auth_session.last_seen_at = now
    session.commit()
    return CurrentUser(
        session_id=auth_session.id,
        owner_id=auth_session.owner_id,
        sub2api_user_id=auth_session.sub2api_user_id,
        email=auth_session.email,
        username=auth_session.username,
        role=auth_session.role,
        credential_id=auth_session.credential_id,
        api_key_id=auth_session.credential.api_key_id if auth_session.credential else None,
        provider_key_fingerprint=auth_session.credential.fingerprint if auth_session.credential else None,
        settings_unlocked_at=auth_session.settings_unlocked_at,
    )


def require_user(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    return current_user


def require_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user


def require_deletion_enabled() -> None:
    if not get_runtime_settings().deletion_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="删除功能已关闭，请联系管理员")

