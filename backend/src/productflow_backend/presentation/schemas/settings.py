from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

ConfigSource = Literal["database", "env_default"]
ConfigInputType = Literal["text", "password", "number", "boolean", "select", "multi_select", "textarea"]


class ConfigOptionResponse(BaseModel):
    value: str
    label: str


class ConfigItemResponse(BaseModel):
    key: str
    label: str
    category: str
    input_type: ConfigInputType
    description: str = ""
    value: str | int | bool | list[str] | None
    source: ConfigSource
    secret: bool = False
    has_value: bool = False
    options: list[ConfigOptionResponse] = Field(default_factory=list)
    minimum: int | None = None
    maximum: int | None = None
    updated_at: str | None = None


class ConfigResponse(BaseModel):
    items: list[ConfigItemResponse]


class RuntimeConfigResponse(BaseModel):
    image_generation_max_dimension: int
    image_tool_allowed_fields: list[str]
    admin_access_required: bool
    deletion_enabled: bool


class ConfigUpdateRequest(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)
    reset_keys: list[str] = Field(default_factory=list)


class SettingsLockStateResponse(BaseModel):
    unlocked: bool
    configured: bool


class SettingsUnlockRequest(BaseModel):
    token: str = Field(min_length=1)


class ProviderProfileResponse(BaseModel):
    id: str
    name: str
    provider_type: str
    base_url: str | None = None
    capabilities: list[str]
    default_models: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    enabled: bool
    archived_at: str | None = None
    has_api_key: bool
    created_at: str
    updated_at: str


class ProviderBindingResponse(BaseModel):
    id: str
    purpose: str
    provider_kind: str
    provider_profile_id: str | None = None
    model_settings: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str


class ProviderConfigResponse(BaseModel):
    profiles: list[ProviderProfileResponse]
    bindings: list[ProviderBindingResponse]


class ProviderProfileCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    base_url: str | None = None
    api_key: str | None = None
    capabilities: list[str] = Field(min_length=1)
    default_models: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class ProviderProfileUpdateRequest(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    capabilities: list[str] | None = None
    default_models: dict[str, Any] | None = None
    config: dict[str, Any] | None = None
    enabled: bool | None = None


class ProviderBindingUpdateRequest(BaseModel):
    provider_kind: str
    provider_profile_id: str | None = None
    model_settings: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
