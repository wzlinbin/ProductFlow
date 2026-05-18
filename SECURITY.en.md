# Security Policy

[中文](SECURITY.md) | English

ProductFlow is a self-hosted project. Deployers are responsible for protecting their admin-compatible key, sub2api integration settings, credential encryption key, model API keys, database, Redis, file storage, and reverse-proxy entrypoints.

## Supported Scope

Security fixes currently prioritize the latest code on the default branch. The project is still early-stage and does not maintain multiple long-term support versions.

## Reporting a Security Issue

Do not post real secrets, database URLs, cookies, model API keys, private images, or production logs in public issues.

If you discover a security issue, contact the maintainers through a private channel. If the repository hosting platform supports private vulnerability reporting, prefer that feature. A useful report should include:

- Impact scope and reproduction steps.
- Affected commit or version.
- Whether relevant configuration uses default values.
- Minimal logs or screenshots, without real secrets.

## Deployer Security Checklist

- Change `ADMIN_ACCESS_KEY`, `SESSION_SECRET`, `CREDENTIAL_VAULT_KEY`, and `POSTGRES_PASSWORD`; do not use example placeholders.
- Do not commit `.env`, `web/.env`, storage, logs, database dumps, or `.trellis/tasks/` / `.trellis/workspace/`.
- Enable HTTPS in production and set `SESSION_COOKIE_SECURE=true`.
- Allow backend access only from trusted origins and configure `BACKEND_CORS_ORIGINS` correctly.
- Redis and PostgreSQL should not be exposed to the public internet.
- sub2api tokens, user API keys, and provider API keys should live only in backend-encrypted credentials, private environment variables, or the settings page. Do not write them into docs, issues, or PRs.
- Upload and generated-file directories should be backed up regularly and protected with access control according to business needs.

## Known Boundaries

The current version depends on external sub2api for identity, registration, 2FA, balance, and API keys. ProductFlow handles local sessions, credential encryption, and business-data owner isolation. It does not provide team permissions, complex RBAC, team audit, built-in payments, or public-registration abuse prevention that replaces sub2api. Before exposing it as a public service, harden reverse proxying, HTTPS, CORS, sub2api abuse controls, and operational monitoring.
