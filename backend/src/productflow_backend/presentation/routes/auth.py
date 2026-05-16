from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from productflow_backend.config import get_runtime_settings, get_settings
from productflow_backend.infrastructure.credential_vault import fingerprint_secret, get_credential_vault
from productflow_backend.infrastructure.db.models import AuthLoginChallenge, AuthSession, UserProviderCredential
from productflow_backend.infrastructure.sub2api_client import Sub2APIClient, Sub2APIError, get_sub2api_client
from productflow_backend.presentation.deps import SESSION_COOKIE_NAME, CurrentUser, as_utc, get_current_user, get_session
from productflow_backend.presentation.schemas.auth import (
    AdminSessionRequest,
    AuthResult,
    AuthSessionState,
    Login2FARequest,
    LoginRequest,
    LogoutResponse,
    PublicAuthSettingsResponse,
    RegisterRequest,
    SendVerifyCodeRequest,
    SendVerifyCodeResponse,
    ViewerUser,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/public-settings", response_model=PublicAuthSettingsResponse)
async def get_public_settings(auth_client: Sub2APIClient = Depends(get_sub2api_client)) -> dict[str, Any]:
    try:
        data = await auth_client.public_settings()
    except Sub2APIError as exc:
        raise _http_error(exc) from exc
    return data if isinstance(data, dict) else {}


@router.post("/send-verify-code", response_model=SendVerifyCodeResponse)
async def send_verify_code(
    payload: SendVerifyCodeRequest,
    auth_client: Sub2APIClient = Depends(get_sub2api_client),
) -> dict[str, Any]:
    try:
        data = await auth_client.send_verify_code(payload.model_dump(exclude_none=True))
    except Sub2APIError as exc:
        raise _http_error(exc) from exc
    if not isinstance(data, dict):
        return {"message": "验证码已发送", "countdown": 60}
    return {"message": str(data.get("message") or "验证码已发送"), "countdown": int(data.get("countdown") or 60)}


@router.post("/register", response_model=AuthResult)
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    auth_client: Sub2APIClient = Depends(get_sub2api_client),
) -> AuthResult:
    try:
        data = await auth_client.register(payload.model_dump(exclude_none=True))
        return await _complete_auth_flow(data, request, response, session, auth_client)
    except Sub2APIError as exc:
        raise _http_error(exc) from exc


@router.post("/login", response_model=AuthResult)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    auth_client: Sub2APIClient = Depends(get_sub2api_client),
) -> AuthResult:
    try:
        data = await auth_client.login(payload.model_dump(exclude_none=True))
    except Sub2APIError as exc:
        raise _http_error(exc) from exc
    if _requires_2fa(data):
        challenge = _create_login_challenge(session, data)
        return AuthResult(
            ok=True,
            requires_2fa=True,
            challenge_id=challenge.id,
            user_email_masked=challenge.email_masked,
        )
    return await _complete_auth_flow(data, request, response, session, auth_client)


@router.post("/login/2fa", response_model=AuthResult)
async def login_2fa(
    payload: Login2FARequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    auth_client: Sub2APIClient = Depends(get_sub2api_client),
) -> AuthResult:
    challenge = session.get(AuthLoginChallenge, payload.challenge_id)
    now = datetime.now(UTC)
    if challenge is None or challenge.consumed_at is not None or challenge.expires_at <= now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"code": "REQUIRES_2FA", "message": "2FA 验证已过期，请重新登录"})
    if challenge.failed_attempts >= 5:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail={"code": "REQUIRES_2FA", "message": "2FA 验证失败次数过多，请重新登录"})

    temp_token = get_credential_vault().decrypt(challenge.encrypted_temp_token)
    try:
        data = await auth_client.login_2fa({"temp_token": temp_token, "totp_code": payload.totp_code})
    except Sub2APIError as exc:
        challenge.failed_attempts += 1
        session.commit()
        raise _http_error(exc) from exc
    challenge.consumed_at = now
    session.commit()
    return await _complete_auth_flow(data, request, response, session, auth_client)


@router.post("/session", response_model=AuthResult)
def create_admin_session(
    payload: AdminSessionRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> AuthResult:
    settings = get_settings()
    runtime_settings = get_runtime_settings()
    if runtime_settings.admin_access_required and (
        not settings.admin_access_key or not secrets.compare_digest(payload.admin_key, settings.admin_access_key)
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="管理员密钥不正确")

    existing_session_id = request.cookies.get(SESSION_COOKIE_NAME)
    existing_session = session.get(AuthSession, existing_session_id) if existing_session_id else None
    now = datetime.now(UTC)
    auth_session = AuthSession(
        id=secrets.token_urlsafe(32),
        owner_id="dev:admin",
        sub2api_user_id="admin",
        username="admin",
        role="admin",
        expires_at=now + timedelta(seconds=settings.sub2api_session_ttl_seconds),
        settings_unlocked_at=(
            existing_session.settings_unlocked_at
            if existing_session and not runtime_settings.admin_access_required
            else None
        ),
        last_seen_at=now,
        user_agent=request.headers.get("user-agent"),
        ip_address=_client_ip(request),
    )
    session.add(auth_session)
    session.commit()
    _set_session_cookie(response, auth_session.id)
    response.delete_cookie("session", path="/")
    return AuthResult(ok=True, viewer=_session_state_from_auth_session(auth_session, None))


@router.get("/session")
def get_session_state(request: Request, session: Session = Depends(get_session)) -> AuthSessionState:
    settings = get_settings()
    if not get_runtime_settings().admin_access_required:
        dev_user = CurrentUser(
            session_id="dev-session",
            owner_id="dev:admin",
            sub2api_user_id="dev-admin",
            email=None,
            username="dev-admin",
            role="admin",
            credential_id=None,
        )
        state = _session_state(dev_user)
        state.access_required = False
        return state
    if not settings.admin_access_key or not request.cookies.get(SESSION_COOKIE_NAME):
        return AuthSessionState(authenticated=False, access_required=True)
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    auth_session = session.get(AuthSession, session_id)
    if auth_session is None or as_utc(auth_session.expires_at) <= datetime.now(UTC):
        return AuthSessionState(authenticated=False, access_required=True)
    return _session_state_from_auth_session(auth_session, auth_session.credential)


@router.delete("/session", response_model=LogoutResponse)
def destroy_session(request: Request, response: Response, session: Session = Depends(get_session)) -> LogoutResponse:
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id:
        auth_session = session.get(AuthSession, session_id)
        if auth_session is not None:
            session.delete(auth_session)
            session.commit()
    _delete_session_cookies(response)
    return LogoutResponse()


@router.post("/logout", response_model=LogoutResponse)
def logout(request: Request, response: Response, session: Session = Depends(get_session)) -> LogoutResponse:
    return destroy_session(request, response, session)


async def _complete_auth_flow(
    auth_result: dict[str, Any],
    request: Request,
    response: Response,
    session: Session,
    auth_client: Sub2APIClient,
) -> AuthResult:
    access_token = str(auth_result.get("access_token") or auth_result.get("token") or "").strip()
    user = auth_result.get("user")
    if not access_token or not isinstance(user, dict):
        raise HTTPException(status_code=502, detail={"code": "SUB2API_UNAVAILABLE", "message": "sub2api 登录响应缺少用户凭据"})

    sub2api_user_id = str(user.get("id") or user.get("user_id") or "").strip()
    if not sub2api_user_id:
        raise HTTPException(status_code=502, detail={"code": "SUB2API_UNAVAILABLE", "message": "sub2api 登录响应缺少用户 ID"})
    owner_id = f"sub2api:{sub2api_user_id}"
    credential = await _resolve_user_credential(session, auth_client, owner_id, sub2api_user_id, access_token)

    settings = get_settings()
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=settings.sub2api_session_ttl_seconds)
    auth_session = AuthSession(
        id=secrets.token_urlsafe(32),
        owner_id=owner_id,
        sub2api_user_id=sub2api_user_id,
        email=str(user.get("email") or "") or None,
        username=str(user.get("username") or user.get("name") or "") or None,
        role=str(user.get("role") or "user"),
        encrypted_access_token=get_credential_vault().encrypt(access_token),
        credential_id=credential.id if credential else None,
        expires_at=expires_at,
        last_seen_at=now,
        user_agent=request.headers.get("user-agent"),
        ip_address=_client_ip(request),
    )
    session.add(auth_session)
    session.commit()
    _set_session_cookie(response, auth_session.id)
    response.delete_cookie("session", path="/")
    return AuthResult(ok=True, viewer=_session_state_from_auth_session(auth_session, credential))


async def _resolve_user_credential(
    session: Session,
    auth_client: Sub2APIClient,
    owner_id: str,
    sub2api_user_id: str,
    access_token: str,
) -> UserProviderCredential | None:
    try:
        keys = await auth_client.list_keys(access_token)
        selected = _select_existing_key(keys)
        api_key = str((selected or {}).get("key") or "").strip()
        api_key_id = str((selected or {}).get("id") or (selected or {}).get("api_key_id") or "").strip() or None
        if not api_key:
            created = await auth_client.create_key(access_token, {"name": "productflow"})
            api_key = str(created.get("key") or "").strip()
            api_key_id = str(created.get("id") or created.get("api_key_id") or "").strip() or None
        if not api_key:
            return None
    except Sub2APIError:
        return None

    credential = UserProviderCredential(
        owner_id=owner_id,
        sub2api_user_id=sub2api_user_id,
        api_key_id=api_key_id,
        encrypted_api_key=get_credential_vault().encrypt(api_key),
        fingerprint=fingerprint_secret(api_key),
    )
    session.add(credential)
    session.flush()
    return credential


def _select_existing_key(keys: list[dict[str, Any]]) -> dict[str, Any] | None:
    candidates = [item for item in keys if isinstance(item.get("key"), str) and item.get("key")]
    if not candidates:
        return None

    def sort_key(item: dict[str, Any]) -> tuple[int, int]:
        status_rank = 0 if item.get("status") in {"active", "enabled", None} else 1
        group = item.get("group") if isinstance(item.get("group"), dict) else {}
        platform_rank = 0 if group.get("platform") == "openai" else 1
        return status_rank, platform_rank

    return sorted(candidates, key=sort_key)[0]


def _create_login_challenge(session: Session, data: dict[str, Any]) -> AuthLoginChallenge:
    temp_token = str(data.get("temp_token") or "").strip()
    if not temp_token:
        raise HTTPException(status_code=502, detail={"code": "REQUIRES_2FA", "message": "sub2api 2FA 响应缺少 challenge 凭据"})
    challenge = AuthLoginChallenge(
        id=secrets.token_urlsafe(32),
        encrypted_temp_token=get_credential_vault().encrypt(temp_token),
        email_masked=str(data.get("user_email_masked") or data.get("email_masked") or "") or None,
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    session.add(challenge)
    session.commit()
    return challenge


def _requires_2fa(data: dict[str, Any]) -> bool:
    return bool(data.get("requires_2fa") or data.get("temp_token"))


def _session_state(current_user: CurrentUser) -> AuthSessionState:
    return AuthSessionState(
        authenticated=True,
        access_required=True,
        user=ViewerUser(
            sub2api_user_id=current_user.sub2api_user_id,
            email=current_user.email,
            username=current_user.username,
            role=current_user.role,
        ),
        is_admin=current_user.is_admin,
        owner_id=current_user.owner_id,
        api_key_source="sub2api" if current_user.credential_id else "none",
        api_key_status="available" if current_user.credential_id else "API_KEY_UNAVAILABLE",
    )


def _session_state_from_auth_session(
    auth_session: AuthSession,
    credential: UserProviderCredential | None,
) -> AuthSessionState:
    return AuthSessionState(
        authenticated=True,
        access_required=True,
        user=ViewerUser(
            sub2api_user_id=auth_session.sub2api_user_id,
            email=auth_session.email,
            username=auth_session.username,
            role=auth_session.role,
        ),
        is_admin=auth_session.role == "admin",
        owner_id=auth_session.owner_id,
        api_key_source="sub2api" if credential else "none",
        api_key_status="available" if credential else "API_KEY_UNAVAILABLE",
    )


def _set_session_cookie(response: Response, session_id: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        max_age=settings.sub2api_session_ttl_seconds,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        path="/",
    )


def _delete_session_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    response.delete_cookie("session", path="/")


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else None


def _http_error(exc: Sub2APIError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message})
