from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from productflow_backend.config import (
    CONFIG_DEFINITION_BY_KEY,
    CONFIG_DEFINITIONS,
    RUNTIME_CONFIG_KEYS,
    build_settings_with_overrides,
    get_runtime_settings,
    get_settings,
    normalize_config_values,
    normalize_image_generation_size,
    parse_image_tool_allowed_fields,
)
from productflow_backend.infrastructure.db.models import AppSetting, AuthSession
from productflow_backend.infrastructure.provider_config import (
    UNSET_PROVIDER_FIELD,
    archive_provider_profile,
    create_provider_profile,
    ensure_provider_config_bootstrapped,
    list_provider_bindings,
    list_provider_profiles,
    update_provider_binding,
    update_provider_profile,
)
from productflow_backend.presentation.deps import CurrentUser, as_utc, get_session, require_admin, require_user
from productflow_backend.presentation.schemas.settings import (
    ConfigItemResponse,
    ConfigOptionResponse,
    ConfigResponse,
    ConfigUpdateRequest,
    ProviderBindingResponse,
    ProviderBindingUpdateRequest,
    ProviderConfigResponse,
    ProviderProfileCreateRequest,
    ProviderProfileResponse,
    ProviderProfileUpdateRequest,
    RuntimeConfigResponse,
    SettingsLockStateResponse,
    SettingsUnlockRequest,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _settings_token_configured() -> bool:
    token = get_settings().settings_access_token
    return bool(token and token.strip())


def require_settings_unlocked(
    current_user: CurrentUser = Depends(require_admin),
    session: Session = Depends(get_session),
) -> None:
    if not _settings_token_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="设置解锁令牌未配置，请联系管理员")
    if current_user.session_id == "dev-session":
        return
    auth_session = session.get(AuthSession, current_user.session_id)
    if auth_session is None or auth_session.settings_unlocked_at is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="请先解锁系统配置")
    expires_at = as_utc(auth_session.settings_unlocked_at) + timedelta(
        seconds=get_runtime_settings().settings_unlock_ttl_seconds
    )
    if expires_at <= datetime.now(UTC):
        auth_session.settings_unlocked_at = None
        session.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="请先解锁系统配置")


def _load_database_values(session: Session) -> dict[str, AppSetting]:
    rows = session.scalars(select(AppSetting).where(AppSetting.key.in_(RUNTIME_CONFIG_KEYS))).all()
    return {row.key: row for row in rows}


def _public_value(value: Any, *, secret: bool) -> str | int | bool | None:
    if secret:
        return ""
    if isinstance(value, Path):
        return str(value)
    return value


def _validate_runtime_settings(overrides: dict[str, str]) -> None:
    settings = build_settings_with_overrides(overrides)
    normalize_image_generation_size(settings.image_main_image_size, label="主图尺寸")
    normalize_image_generation_size(settings.image_promo_poster_size, label="促销海报尺寸")
    if not settings.allowed_image_mime_types:
        raise ValueError("允许图片 MIME 不能为空")


def _serialize_config(session: Session) -> ConfigResponse:
    db_values = _load_database_values(session)
    settings = get_runtime_settings()
    items: list[ConfigItemResponse] = []
    for definition in CONFIG_DEFINITIONS:
        source = "database" if definition.key in db_values else "env_default"
        raw_value = getattr(settings, definition.key)
        effective_value = (
            list(parse_image_tool_allowed_fields(raw_value))
            if definition.input_type == "multi_select"
            else _public_value(raw_value, secret=definition.secret)
        )
        db_value = db_values.get(definition.key)
        has_value = bool(db_value.value if db_value is not None else raw_value)
        items.append(
            ConfigItemResponse(
                key=definition.key,
                label=definition.label,
                category=definition.category,
                input_type=definition.input_type,
                description=definition.description,
                value=effective_value,
                source=source,
                secret=definition.secret,
                has_value=has_value,
                options=[ConfigOptionResponse(value=option.value, label=option.label) for option in definition.options],
                minimum=definition.minimum,
                maximum=definition.maximum,
                updated_at=db_value.updated_at.isoformat() if db_value is not None else None,
            )
        )
    return ConfigResponse(items=items)


def _serialize_provider_profile(profile) -> ProviderProfileResponse:
    return ProviderProfileResponse(
        id=profile.id,
        name=profile.name,
        provider_type=profile.provider_type,
        base_url=profile.base_url,
        capabilities=list(profile.capabilities_json or []),
        default_models=dict(profile.default_models_json or {}),
        config=dict(profile.config_json or {}),
        enabled=profile.enabled,
        archived_at=profile.archived_at.isoformat() if profile.archived_at is not None else None,
        has_api_key=bool(profile.api_key),
        created_at=profile.created_at.isoformat(),
        updated_at=profile.updated_at.isoformat(),
    )


def _serialize_provider_binding(binding) -> ProviderBindingResponse:
    return ProviderBindingResponse(
        id=binding.id,
        purpose=binding.purpose,
        provider_kind=binding.provider_kind,
        provider_profile_id=binding.provider_profile_id,
        model_settings=dict(binding.model_settings_json or {}),
        config=dict(binding.config_json or {}),
        created_at=binding.created_at.isoformat(),
        updated_at=binding.updated_at.isoformat(),
    )


def _serialize_provider_config(session: Session) -> ProviderConfigResponse:
    return ProviderConfigResponse(
        profiles=[_serialize_provider_profile(profile) for profile in list_provider_profiles(session)],
        bindings=[_serialize_provider_binding(binding) for binding in list_provider_bindings(session)],
    )


@router.get("/lock-state", response_model=SettingsLockStateResponse)
def get_settings_lock_state_endpoint(
    current_user: CurrentUser = Depends(require_admin),
    session: Session = Depends(get_session),
) -> SettingsLockStateResponse:
    configured = _settings_token_configured()
    unlocked = False
    if configured:
        if current_user.session_id == "dev-session":
            unlocked = True
        else:
            auth_session = session.get(AuthSession, current_user.session_id)
            if auth_session and auth_session.settings_unlocked_at:
                expires_at = as_utc(auth_session.settings_unlocked_at) + timedelta(
                    seconds=get_runtime_settings().settings_unlock_ttl_seconds,
                )
                unlocked = expires_at > datetime.now(UTC)
    return SettingsLockStateResponse(unlocked=unlocked, configured=configured)


@router.post("/unlock", response_model=SettingsLockStateResponse)
def unlock_settings_endpoint(
    payload: SettingsUnlockRequest,
    current_user: CurrentUser = Depends(require_admin),
    session: Session = Depends(get_session),
) -> SettingsLockStateResponse:
    expected_token = (get_settings().settings_access_token or "").strip()
    if not expected_token:
        raise HTTPException(status_code=503, detail="设置解锁令牌未配置，请联系管理员")
    if not secrets.compare_digest(payload.token, expected_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="设置解锁令牌不正确")
    if current_user.session_id != "dev-session":
        auth_session = session.get(AuthSession, current_user.session_id)
        if auth_session is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
        auth_session.settings_unlocked_at = datetime.now(UTC)
        session.commit()
    return SettingsLockStateResponse(unlocked=True, configured=True)


@router.get("", response_model=ConfigResponse, dependencies=[Depends(require_settings_unlocked)])
def get_config_endpoint(session: Session = Depends(get_session)) -> ConfigResponse:
    return _serialize_config(session)


@router.get(
    "/provider-config",
    response_model=ProviderConfigResponse,
    dependencies=[Depends(require_settings_unlocked)],
)
def get_provider_config_endpoint(session: Session = Depends(get_session)) -> ProviderConfigResponse:
    ensure_provider_config_bootstrapped(session)
    return _serialize_provider_config(session)


@router.post(
    "/provider-profiles",
    response_model=ProviderProfileResponse,
    dependencies=[Depends(require_settings_unlocked)],
)
def create_provider_profile_endpoint(
    payload: ProviderProfileCreateRequest,
    session: Session = Depends(get_session),
) -> ProviderProfileResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        profile = create_provider_profile(
            session,
            name=payload.name,
            base_url=payload.base_url,
            api_key=payload.api_key,
            capabilities=payload.capabilities,
            default_models=payload.default_models,
            config=payload.config,
            enabled=payload.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_provider_profile(profile)


@router.patch(
    "/provider-profiles/{profile_id}",
    response_model=ProviderProfileResponse,
    dependencies=[Depends(require_settings_unlocked)],
)
def update_provider_profile_endpoint(
    profile_id: str,
    payload: ProviderProfileUpdateRequest,
    session: Session = Depends(get_session),
) -> ProviderProfileResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        fields_set = payload.model_fields_set
        profile = update_provider_profile(
            session,
            profile_id,
            name=payload.name,
            base_url=payload.base_url if "base_url" in fields_set else UNSET_PROVIDER_FIELD,
            api_key=payload.api_key if "api_key" in fields_set else UNSET_PROVIDER_FIELD,
            capabilities=payload.capabilities,
            default_models=payload.default_models,
            config=payload.config,
            enabled=payload.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_provider_profile(profile)


@router.delete(
    "/provider-profiles/{profile_id}",
    response_model=ProviderProfileResponse,
    dependencies=[Depends(require_settings_unlocked)],
)
def archive_provider_profile_endpoint(
    profile_id: str,
    session: Session = Depends(get_session),
) -> ProviderProfileResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        profile = archive_provider_profile(session, profile_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_provider_profile(profile)


@router.patch(
    "/provider-bindings/{purpose}",
    response_model=ProviderBindingResponse,
    dependencies=[Depends(require_settings_unlocked)],
)
def update_provider_binding_endpoint(
    purpose: str,
    payload: ProviderBindingUpdateRequest,
    session: Session = Depends(get_session),
) -> ProviderBindingResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        binding = update_provider_binding(
            session,
            purpose=purpose,
            provider_kind=payload.provider_kind,
            provider_profile_id=payload.provider_profile_id,
            model_settings=payload.model_settings,
            config=payload.config,
        )
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_provider_binding(binding)


@router.get("/runtime", response_model=RuntimeConfigResponse)
def get_runtime_config_endpoint(current_user: CurrentUser = Depends(require_user)) -> RuntimeConfigResponse:
    settings = get_runtime_settings()
    return RuntimeConfigResponse(
        image_generation_max_dimension=settings.image_generation_max_dimension,
        image_tool_allowed_fields=list(parse_image_tool_allowed_fields(settings.image_tool_allowed_fields)),
        admin_access_required=settings.admin_access_required,
        deletion_enabled=settings.deletion_enabled,
    )


@router.patch("", response_model=ConfigResponse, dependencies=[Depends(require_settings_unlocked)])
def update_config_endpoint(
    payload: ConfigUpdateRequest,
    session: Session = Depends(get_session),
) -> ConfigResponse:
    unknown_keys = (set(payload.values) | set(payload.reset_keys)) - set(CONFIG_DEFINITION_BY_KEY)
    if unknown_keys:
        raise HTTPException(status_code=400, detail=f"未知配置项: {', '.join(sorted(unknown_keys))}")

    reset_keys = set(payload.reset_keys)
    if reset_keys & set(payload.values):
        raise HTTPException(status_code=400, detail="同一个配置项不能同时更新和恢复默认")

    try:
        normalized_values = normalize_config_values(payload.values)
        current_values = _load_database_values(session)
        next_values = {key: row.value for key, row in current_values.items() if key not in reset_keys}
        next_values.update(normalized_values)
        _validate_runtime_settings(next_values)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    for key in reset_keys:
        existing = session.get(AppSetting, key)
        if existing is not None:
            session.delete(existing)
    for key, value in normalized_values.items():
        existing = session.get(AppSetting, key)
        if existing is None:
            session.add(AppSetting(key=key, value=value))
        else:
            existing.value = value
    session.commit()
    return _serialize_config(session)
