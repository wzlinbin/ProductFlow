from __future__ import annotations

from pydantic import BaseModel, Field


class PublicAuthSettingsResponse(BaseModel):
    registration_enabled: bool = True
    email_verify_enabled: bool = False
    force_email_on_third_party_signup: bool = False
    promo_code_enabled: bool = False
    invitation_code_enabled: bool = False
    totp_enabled: bool = False
    turnstile_enabled: bool = False
    turnstile_site_key: str = ""
    backend_mode_enabled: bool = False
    site_name: str = "ProductFlow"
    site_subtitle: str = ""


class SendVerifyCodeRequest(BaseModel):
    email: str
    turnstile_token: str | None = None


class SendVerifyCodeResponse(BaseModel):
    message: str
    countdown: int = 60


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=1)
    verify_code: str | None = None
    turnstile_token: str | None = None
    promo_code: str | None = None
    invitation_code: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=1)
    turnstile_token: str | None = None


class Login2FARequest(BaseModel):
    challenge_id: str = Field(min_length=1)
    totp_code: str = Field(min_length=1)


class AdminSessionRequest(BaseModel):
    admin_key: str = ""


class ViewerUser(BaseModel):
    sub2api_user_id: str
    email: str | None = None
    username: str | None = None
    role: str


class AuthSessionState(BaseModel):
    authenticated: bool
    access_required: bool = True
    user: ViewerUser | None = None
    is_admin: bool = False
    owner_id: str | None = None
    api_key_source: str = "none"
    api_key_status: str | None = None


class AuthResult(BaseModel):
    ok: bool = True
    viewer: AuthSessionState | None = None
    requires_2fa: bool = False
    challenge_id: str | None = None
    user_email_masked: str | None = None


class LogoutResponse(BaseModel):
    ok: bool = True
