# ProductFlow 升级为 sub2api 多用户版本计划

## 背景与目标

当前 ProductFlow 是管理员密钥保护的单用户系统：业务接口依赖 `require_admin`，Product、ImageSession、UserCanvasTemplate 等业务数据没有用户归属字段。目标是升级为与 sub2api 高度整合的多用户版本：用户直接使用 sub2api 登录、注册、查余额、获取/使用 API Key；现有系统设置模块继续作为管理员专用能力。

参考项目 `E:\个人项目\syber-gpt-image-2` 的可复用思路是：后端代理 sub2api 认证与 key 接口，浏览器只拿 HttpOnly session cookie，sub2api access token 和用户 API Key 都只保存在后端，业务数据通过 owner_id 隔离。

## 当前相关实现

### 当前 ProductFlow

- `backend/src/productflow_backend/presentation/routes/auth.py`：当前 `/api/auth/session` 是 admin key 登录。
- `backend/src/productflow_backend/presentation/deps.py`：当前 `require_admin` 只检查 `request.session["is_authenticated"]`。
- `backend/src/productflow_backend/presentation/routes/settings.py`：`/api/settings` 和 provider 配置是全局系统设置，另有 settings access token 二次解锁。
- `backend/src/productflow_backend/presentation/routes/products.py`、`image_sessions.py`、`product_workflows.py`、`gallery.py`：当前业务路由都按管理员保护，未按用户隔离。
- `backend/src/productflow_backend/infrastructure/provider_config.py`：文案和图片 provider 从全局 provider profiles/bindings 解析。
- `backend/src/productflow_backend/infrastructure/db/models.py`：Product、ImageSession、UserCanvasTemplate、ImageGalleryEntry 等没有 owner_id。
- `backend/alembic/versions/`：项目已有 Alembic 迁移链，最新到 `20260513_0028_repair_provider_bindings_id.py`。
- `web/src/App.tsx`：前端根据 session authenticated 控制路由。
- `web/src/pages/LoginPage.tsx`：当前是 admin key 登录页。
- `web/src/pages/SettingsPage.tsx`：当前是全局设置页。

### 参考项目 syber-gpt-image-2

- `backend/app/auth_client.py` 封装 sub2api：public settings、send verify code、register、login、login 2FA、keys、available groups、usage。
- `backend/app/main.py`：登录成功后创建本地 session，owner_id 来自 sub2api user id，管理员身份来自 sub2api role，生成时使用用户自己的 API Key。
- 前端提供 Login、Register、Account、Config 页面，普通用户看账号/余额，管理员才看到站点设置。

## 方案原则

1. **sub2api 是身份与计费真源**：ProductFlow 不保存密码、不自行实现验证码/2FA、不做本地扣费。
2. **浏览器不接触敏感凭据**：sub2api access token、2FA temp token、用户 API Key 只留在后端；前端只持有 HttpOnly session cookie 和非敏感 challenge id。
3. **认证切换和数据隔离不可拆开上线**：多用户登录、owner_id 迁移、业务路由过滤、下载归属校验必须作为同一个第一可发布版本交付；开发可分阶段，部署不可分阶段。
4. **所有按 id 访问都必须走 owner 查询函数**：禁止业务代码直接 `session.get(Model, id)` 后再临时判断，避免旁路接口漏校验。
5. **设置页保持管理员专用**：普通用户只能使用业务页、账号页和余额；全局 provider、提示词、安全、队列设置必须由后端 `require_admin` 强制拦截。
6. **第一可发布版本优先**：不做组织、团队共享、复杂 RBAC、本地账本、公共精选图库、token 自动刷新、凭据轮换。

## 内部数据契约

为了隔离 sub2api 响应差异，ProductFlow 内部只使用稳定 DTO，sub2api client 负责把外部响应转换成这些结构：

- `SessionUser`：`sub2api_user_id`、`email`、`username`、`role`、`owner_id`。
- `AuthLoginResult`：`ok`、`viewer?`、`requires_2fa?`、`challenge_id?`、`user_email_masked?`。不向前端返回 sub2api `temp_token`。
- `ApiKeyStatus`：`available`、`credential_id?`、`api_key_id?`、`message?`。
- `BalanceSummary`：`ok`、`remaining`、`message`。API 响应不返回 sub2api 原始 `raw`；服务端如需排查，只保存裁剪且脱敏的 `provider_payload`。
- `AuthSessionState`：`authenticated`、`access_required`、`user`、`is_admin`、`owner_id`、`api_key_source`（`sub2api` 或 `none`）、`api_key_status`。

统一错误格式：`{ code, message, details? }`。关键 code：

- 认证/上游：`SUB2API_UNAVAILABLE`、`INVALID_CREDENTIALS`、`REQUIRES_2FA`、`REGISTRATION_DISABLED`、`VERIFY_CODE_INVALID`、`API_KEY_UNAVAILABLE`、`SESSION_EXPIRED`、`ADMIN_REQUIRED`
- 业务/媒体：`RESOURCE_NOT_FOUND`、`MEDIA_NOT_AVAILABLE`、`TASK_KEY_EXPIRED`、`BALANCE_UNAVAILABLE`

## 后端实施计划

### 1. sub2api 与安全配置

在 `config.py` 增加仅从环境变量读取的基础配置：

- `sub2api_auth_base_url`：sub2api 管理/认证服务地址。
- `sub2api_provider_base_url`：OpenAI 兼容调用地址。
- `sub2api_session_ttl_seconds`：本地会话有效期，默认使用较短 TTL；如果 sub2api 返回 access token 过期时间，本地 TTL 不得超过它。
- `sub2api_balance_cache_ttl_seconds`：余额短缓存时间，默认 30-60 秒。
- `settings_unlock_ttl_seconds`：管理员设置二次解锁 TTL，默认 15 分钟。
- `credential_vault_key`：独立凭据加密密钥，启动时强校验存在和长度。
- `session_cookie_samesite`：默认 `Lax`；只有前后端真实跨站部署时才允许设为 `None`。

`credential_vault_key` 不复用 `session_secret`。第一可发布版本不支持密钥轮换；变更该值会导致已有加密 token/key 无法解密，必须在部署说明中标记为“不可随意修改”。这些值不进入普通运行时设置表；管理员设置页可只读展示有效状态，但不展示密钥内容。

`credential_vault` 必须使用成熟认证加密（优先 AES-GCM 或 Fernet），每次加密使用随机 nonce/IV，密文带版本前缀，例如 `v1...`，并在启动时校验 vault key 的编码、长度和算法匹配。

### 2. sub2api 客户端

新增 `backend/src/productflow_backend/infrastructure/sub2api_client.py`，参考 syber 的 `Sub2APIAuthClient` 实现：

- `public_settings()`
- `send_verify_code(payload)`
- `register(payload) -> AuthLoginResult`
- `login(payload) -> AuthLoginResult`
- `login_2fa(payload) -> AuthLoginResult`
- `list_keys(access_token) -> list[dict]`
- `create_key(access_token, payload) -> ApiKeyStatus`
- `list_usage(access_token, params) -> BalanceSummary`

连接失败映射为 `SUB2API_UNAVAILABLE` + 502；认证失败映射为稳定 code；不透传 token、key、完整响应头或过大的原始响应。任何需要 access token 的接口收到 sub2api 401/403 时，统一使本地 session 失效、清除 access token、删除 cookie，并要求重新登录。

### 3. 2FA 临时挑战

新增 `auth_login_challenges` 表或等价短 TTL 存储：

- `id`：随机 challenge id，返回前端。
- `encrypted_temp_token`：sub2api 2FA temp token，只在后端保存。
- `email_masked`
- `expires_at`：短 TTL，例如 5 分钟。
- `failed_attempts`
- `consumed_at`
- `created_at`

`POST /api/auth/login` 若 sub2api 要求 2FA：后端保存 temp token，前端只拿 `challenge_id` 和 masked email。`POST /api/auth/login/2fa` 使用 `challenge_id + totp_code` 完成登录，成功后标记 challenge consumed；过期、重复使用、错误次数过多都失败。

### 4. 凭据存储与生命周期

新增 `user_provider_credentials` 表，集中保存用户的 sub2api API Key，不把 key 明文复制到各任务表。每一行都是不可变 credential 版本：用户重新登录、key 重建或 key 变化时插入新行，不覆盖旧行。

字段：

- `id`
- `owner_id`
- `sub2api_user_id`
- `api_key_id`
- `encrypted_api_key`
- `fingerprint`
- `created_at` / `last_used_at`
- `superseded_at` 可选
- `revoked_at` 可选

新增 `credential_vault` 工具，用独立 `credential_vault_key` 对 access token、2FA temp token 和 API Key 做服务端加密后落库。不把 token/key 写入日志、异常、API 响应或前端缓存。

登录/注册成功但 API Key 获取或创建失败时，仍允许创建用户 session，但 `credential_id=null`、`api_key_source="none"`、`api_key_status` 返回 `API_KEY_UNAVAILABLE`；账号页显示 key 不可用，生成接口不入队并返回稳定错误 `API_KEY_UNAVAILABLE`。

凭据清理规则：

- auth session 删除或过期后，不立即删除 credential；仍被 queued/running 任务引用的 credential 保留。
- terminal task（completed/failed/cancelled/expired）结束后，只保留 credential id 和 fingerprint；任务表从不保存明文或密文 key。
- 定期或启动时清理：无 active session、无 queued/running task 引用、且超过保留窗口的 credential 可删除或标记 revoked。
- 日志和序列化响应只允许出现 fingerprint。

### 5. 本地认证会话表

新增 `auth_sessions` 表：

- `id`：随机 session id，写入 HttpOnly cookie。
- `owner_id`：`sub2api:{user_id}`。
- `sub2api_user_id`
- `email`
- `username`
- `role`
- `encrypted_access_token`
- `credential_id`：可为空；为空表示用户已登录但暂时没有可用 sub2api API Key。
- `expires_at`
- `settings_unlocked_at`：管理员设置二次解锁状态，不再依赖 `request.session`。
- `created_at` / `updated_at` / `last_seen_at`
- `user_agent` / `ip_address` 可选。

不保存 `refresh_token`，因为第一可发布版本不做 token 自动刷新。access token 纳入 credential vault 的加密、防泄漏、清理测试；session 删除/过期或 sub2api 401/403 后清除 token 并删除 cookie。管理员角色使用登录时快照，接受最长一个本地 session TTL 的延迟；TTL 应保持较短，settings access token 仍作为敏感设置的第二道门。

### 6. 会话 cookie 机制

废弃 `request.session["is_authenticated"]` 认证，不再用 Starlette SessionMiddleware 承载登录状态。

新 cookie：

- 名称：`productflow_session`。
- 值：`auth_sessions.id`。
- `HttpOnly=true`。
- `SameSite` 默认 `Lax`，适用于同站部署或同站跨源开发环境。
- 如第一版需要真实跨站部署，必须显式设置 `SameSite=None` 且 `Secure=true`，并配置严格 CORS allowlist；否则不声明支持真实跨站 cookie 会话。
- `Secure` 跟随现有 `session_cookie_secure`，但 `SameSite=None` 时强制为 true。
- `Path=/`。
- `Max-Age=sub2api_session_ttl_seconds`。

登录成功时：设置 `productflow_session`，并删除旧的 `session` cookie，避免旧 admin 会话残留。

登出时：删除 `auth_sessions` 记录或标记失效，删除 `productflow_session` 和旧 `session` cookie。

前端 `web/src/lib/api.ts` 已统一 `credentials: "include"`，保留该行为。真实跨站部署只有在 `SameSite=None; Secure=true` 和严格 CORS allowlist 同时启用时才受支持。后端对带 cookie 的 unsafe methods（POST/PATCH/PUT/DELETE）做 Origin 校验：

- Origin 存在时必须匹配配置允许的 CORS origin。
- Origin 不存在时允许，用于同源导航、非浏览器客户端或部分代理场景。
- 非法 Origin 拒绝。
- 反向代理只信任明确配置的 forwarded headers，不从任意 header 推断可信 origin。

### 7. 认证路由

将 `/api/auth/session` 从 admin key 会话改为 sub2api 用户会话：

- `GET /api/auth/public-settings`：代理 sub2api public settings。
- `POST /api/auth/send-verify-code`：代理 sub2api。
- `POST /api/auth/register`：代理 sub2api 注册，成功后获取/创建用户 API Key，创建 credential 和 auth session 并设置 cookie。
- `POST /api/auth/login`：代理 sub2api 登录；若需要 2FA，创建 challenge 并返回 `challenge_id`；否则创建 credential 和 auth session。
- `POST /api/auth/login/2fa`：用 `challenge_id + totp_code` 完成 2FA，创建 credential 和 auth session。
- `GET /api/auth/session`：返回 `AuthSessionState`。
- `DELETE /api/auth/session` 或 `POST /api/auth/logout`：删除本地 session 并清 cookie。

旧 admin key 登录完全废弃，不保留 emergency 后门，避免两套权限系统混用。管理员身份只来自 sub2api `role == "admin"`，系统设置仍需要 settings access token 二次解锁。

### 8. 设置二次解锁迁移

保留 `require_settings_unlocked` 概念，但改为读取 `auth_sessions.settings_unlocked_at`：

- 普通用户访问 settings/provider API：先被 `require_admin` 拒绝。
- admin 未解锁：403。
- admin 解锁成功：写入当前 auth session 的 `settings_unlocked_at=now`。
- 解锁 TTL 超过 `settings_unlock_ttl_seconds` 后重新要求输入 settings access token。
- 重新登录会创建新 auth session，默认未解锁。
- 登出会删除 session，解锁状态自然失效。

原 `request.session["settings_unlocked"]` 依赖全部移除。测试覆盖未解锁 admin、已解锁 admin、过期解锁、普通用户访问。

### 9. 认证依赖

在 `presentation/deps.py` 增加：

- `CurrentUser`：`owner_id`、`sub2api_user_id`、`email`、`username`、`role`、`credential_id?`、`api_key_id?`、`provider_key_fingerprint?`。
- `get_current_user(request, db)`：从 `productflow_session` 查 `auth_sessions`，不存在或过期则 401。
- `require_user(current_user)`：登录用户即可。
- `require_admin(current_user)`：必须 `role == "admin"`。

业务路由改用 `require_user`；settings、provider config、generation_queue 继续用 `require_admin`。前端可隐藏入口，但真正权限必须由后端测试覆盖。

### 10. 用户数据隔离迁移

迁移拆成两步，但 preflight 必须集成到 Alembic 迁移脚本开头，不能被直接 `alembic upgrade head` 绕过：

1. **preflight 只读检查**：发现阻断项直接失败，不修改 schema/data。
2. **schema/data migration**：只在 preflight 通过后执行。

同时提供一个可重复执行的只读检查命令，用于上线前演练；正式迁移仍以内置 preflight 为准。

阻断项：

- 已有 Product/ImageSession/UserCanvasTemplate/Gallery 数据，但未设置 `MIGRATION_DEFAULT_OWNER_ID=sub2api:{admin_user_id}`。
- 同一 owner 下会造成 `(owner_id, key)` 冲突的 user template key。
- 指向不存在根实体的孤儿子表记录。
- 任何会导致 owner_id 非空约束失败的数据。

新增字段：

- `products.owner_id`，索引 `(owner_id, created_at)`。
- `image_sessions.owner_id`，索引 `(owner_id, updated_at)`。
- `user_canvas_templates.owner_id`，索引 `(owner_id, archived_at)`，模板唯一约束改为 `(owner_id, key)`。
- `image_gallery_entries.owner_id`，第一可发布版本作为用户私有图库。
- 异步任务表保存 `owner_id`、`sub2api_user_id`、`credential_id`、`provider_key_fingerprint`，至少覆盖 `image_session_generation_tasks`；如 ProductWorkflow worker 会异步调用 provider，也要覆盖对应 run/task 记录。

子表不全部重复 owner_id，但所有访问必须经统一 owner 查询函数校验根实体归属。

### 11. 统一 owner 查询层

为每类根实体建立统一查询函数，业务路由和 use case 禁止直接按 id 查资源：

- `get_product_for_owner(session, product_id, owner_id)`
- `get_image_session_for_owner(session, image_session_id, owner_id)`
- `get_template_for_owner(session, template_id_or_key, owner_id)`
- `get_gallery_entry_for_owner(session, entry_id, owner_id)`
- `get_source_asset_for_owner(session, asset_id, owner_id)`：通过 Product join。
- `get_poster_for_owner(session, poster_id, owner_id)`：通过 Product join。
- `get_image_session_asset_for_owner(session, asset_id, owner_id)`：通过 ImageSession join。

跨用户访问统一返回 404，避免暴露资源是否存在。验证步骤中必须搜索路由和 use case 中的 `session.get(`、`where(Model.id ==`、直接按 id 查询模式；发现资源访问绕过 owner 查询函数则不能通过检查。

### 12. 业务路由改造

将业务路由从管理员依赖改为用户依赖，并传入 `CurrentUser.owner_id`：

- `/api/products`：创建写入 `Product.owner_id`；列表、详情、删除、历史按 owner 查询。
- `/api/products/{product_id}/...`：所有子操作通过 `get_product_for_owner`。
- `/api/image-sessions`：创建/list/detail/update/delete/generate 按 `ImageSession.owner_id`；绑定 product 时要求两者同 owner。
- `/api/workflow...`：所有 workflow 操作先验证 product owner。
- `/api/gallery`：用户私有图库，list/save/delete 按 owner_id。
- `/api/generation-queue`：管理员专用全局队列；普通用户只从自己的 image session/task 状态看进度。
- 所有下载接口先用 owner 查询函数拿到资源，再打开文件。

物理文件层要求：用户生成文件不能通过静态目录直接公开访问；如当前有静态文件服务，要么只服务公开静态资产，要么对用户上传/生成目录禁用直出。用户媒体只能通过受保护下载/预览 API 返回。

### 13. 受保护媒体访问改造

后端：

- 为图片预览和下载提供受保护 API，内部先做 owner 校验再读文件。
- 序列化业务对象时返回受保护 API URL，而不是裸文件系统/静态 URL。
- 对旧的直出 URL 做兼容时也必须通过后端校验，不允许直接暴露用户存储目录。

前端：

- 普通 `<img src>` 只用于同站受保护 URL；同站 cookie 会随请求发送。
- 如果 `VITE_API_BASE_URL` 跨源或画布需要读取像素，使用 `fetch` + `credentials: "include"` 拉取 blob，再创建 object URL；真实跨站部署必须启用 `SameSite=None; Secure=true` 与严格 CORS allowlist。
- 工作流画布、图库、图片会话预览、下载按钮都统一走媒体 URL helper，避免各处拼 URL。
- 手动验收必须覆盖图片预览、画布展示、下载、跨用户直接访问图片 URL。

### 14. 用户级供应商解析

新增“用户生成运行配置”，不要把普通用户生成路径接到全局 provider profile：

- `UserGenerationConfig` 只包含：`credential_id`、解密后的短生命周期 `api_key`、`base_url`、默认模型、尺寸、提示词模板、图片工具允许字段等。
- `api_key` 来自 credential vault 解密，不进入前端、不进入日志。
- `base_url` 来自 `sub2api_provider_base_url`。
- 模型、尺寸、提示词模板来自全局设置的非密钥字段。
- 全局 provider profile/binding 只供管理员设置页和系统维护路径使用，普通用户生成不得读取全局 provider api_key。

文案/图片 use case 改为显式接收 `UserGenerationConfig` 或 `CurrentUser`，不再在普通用户路径中调用全局 `resolve_text_provider_config()` / `resolve_image_provider_config()`。

### 15. 后台任务 credential 绑定策略

禁止 worker 通过 “owner_id 查最新 session” 隐式拿 key。

任务创建时写入：

- `owner_id`
- `sub2api_user_id`
- `credential_id`
- `provider_base_url`
- `provider_key_fingerprint`

任务执行时按 immutable `credential_id` 获取当时绑定的 credential；如果 credential 已清理、被撤销或无法解密，任务失败并返回 `TASK_KEY_EXPIRED`。任务表不保存明文或密文 API Key。

### 16. 账号与余额接口

新增：

- `GET /api/account`：当前用户信息、owner_id、API Key 状态、余额摘要；API Key 不可用时返回 `api_key_source="none"` 和 `API_KEY_UNAVAILABLE`。
- `GET /api/balance`：使用当前 session access token 查询 sub2api usage/余额。

余额接口增加短 TTL 缓存，避免账号页频繁调用 sub2api。查询失败返回 `{ ok: false, remaining: null, message }`，不阻塞业务页面。API 响应不返回原始 sub2api payload。

### 17. 前端路由与页面

修改 `web/src/App.tsx`：

- `/login`：sub2api 邮箱/密码登录，支持 2FA；2FA 使用 `challenge_id`，不接触 sub2api temp token。
- `/register`：sub2api 注册，按 public settings 展示验证码、邀请码等字段。
- `/account`：显示用户、余额、API Key 状态、退出按钮。
- `/settings`：前端只给 admin 展示入口；非 admin 跳 `/account` 或显示无权限。后端仍必须强制 403。
- `/products`、`/image-chat`、`/gallery`、`/help`：登录用户可进入。

修改 `web/src/lib/api.ts`：

- 新增 public settings、send verify code、register、login、login2FA、logout、account、balance。
- `getSessionState()` 返回 `AuthSessionState`。
- 移除 admin key 登录调用。

保留现有 SettingsPage UI，但只服务管理员。

## 测试计划

后端：

- sub2api client：成功、错误 payload、非 JSON、连接失败、字段缺失。
- auth routes：public settings、注册、登录、2FA challenge、challenge 过期/重复/失败次数、登出、旧 cookie 清理、session 过期、key 获取失败后仍可登录但生成返回 `API_KEY_UNAVAILABLE`。
- cookie/session：新 cookie 属性、登出清理、旧 `session` cookie 删除、Origin 校验、前端 credentials；覆盖 `SameSite=Lax` 同站模式和 `SameSite=None; Secure=true` 跨站模式。
- Origin/CORS：允许 origin 成功、非法 origin 拒绝、无 Origin 按策略允许；跨站模式必须验证 CORS allowlist 和 cookie 可用性。
- settings unlock：未解锁 admin、已解锁 admin、过期解锁、普通用户访问。
- 权限：未登录 401；普通用户可访问业务路由；普通用户访问 settings/provider/generation_queue 为 403；admin 可访问 settings。
- 数据隔离：用户 A/B 的 product、image session、workflow、gallery、template、download、attach、retry、cancel 全部互不可见。
- owner 查询旁路检查：搜索并审查路由/use case 中直接按 id 查询资源的代码。
- 供应商解析：普通用户生成只使用用户 credential 和 sub2api provider base_url，不读取全局 provider api_key。
- 后台任务：任务保存 owner/credential id；登出后已入队任务行为符合策略；credential 缺失返回 `TASK_KEY_EXPIRED`；无 key 不入队。
- 凭据安全：API 响应、日志、异常不包含 temp token/access token/api key；terminal task 不保存 key 明文/密文快照；session 删除/过期清 access token；vault 使用认证加密、随机 nonce/IV、版本化密文格式。
- 迁移 preflight：缺少默认 owner、重复 template key、孤儿记录、唯一约束冲突均阻断；直接 `alembic upgrade head` 也会触发 preflight。
- 文件访问：用户媒体不能绕过 DB owner 校验直接访问。

前端：

- api 类型和请求方法。
- Login/Register：成功、错误、2FA challenge、验证码倒计时。
- Account：余额成功/失败都能显示，不依赖 raw payload。
- Settings：普通用户不可进入，管理员可进入，二次解锁过期可重解锁。
- 媒体：同站 `<img>`、跨站 blob/object URL、画布展示、下载按钮。

手动验收：

1. 普通用户注册并登录。
2. 需要 2FA 的用户只在前端看到 challenge id，不看到 temp token。
3. 普通用户创建产品、生成图片、刷新后数据仍在。
4. 另一个用户登录后看不到第一个用户的数据，直接访问详情/下载/图片 URL 返回 404。
5. 普通用户打开 `/settings` 被拒绝，直接请求 settings API 返回 403。
6. 管理员登录后可进入 `/settings`，完成设置解锁，TTL 后需要重新解锁。
7. 余额查询失败时业务页面仍可使用，只显示余额不可用。
8. 登出后旧 cookie 和新 cookie 都失效。

## 第一可发布版本不可裁剪项

以下必须一起完成后才能上线：

- sub2api 登录、注册、2FA challenge、登出、session。
- 独立 credential vault key 和凭据加密存储。
- 新 cookie 会话机制和旧 cookie 清理。
- settings 二次解锁迁移到 auth session。
- owner_id 迁移和旧数据 owner 明确绑定。
- 所有业务根实体 owner 过滤。
- 所有按 id 访问和下载/预览接口 owner 校验。
- 普通用户生成使用用户 credential，不使用全局 provider key。
- 受保护媒体访问改造。
- settings/provider/generation_queue 后端管理员权限测试。
- 跨用户隔离测试。

可作为开发顺序但不能单独部署的内部步骤：

1. 认证、cookie 和 2FA challenge 骨架。
2. credential vault 与 sub2api client。
3. owner_id preflight、迁移和统一查询函数。
4. settings unlock 迁移。
5. 业务路由隔离。
6. 用户 credential 生成调用与后台任务 credential 绑定。
7. 受保护媒体访问。
8. 前端登录/注册/账号/管理员设置入口。
9. 全量测试和手动验收。

## 明确不做的内容

- 不在 ProductFlow 实现密码、邮箱验证码、2FA 算法。
- 不保留旧 admin key 后门。
- 不做组织/团队/共享项目。
- 不做复杂 RBAC，只有普通用户和管理员。
- 不做本地充值/扣费账本，余额以 sub2api 为准。
- 不做公共精选图库，第一可发布版本先做用户私有图库。
- 不做 token 自动刷新，session/access token 失效后重新登录。
- 不做 credential vault key 轮换；第一版要求部署后保持 vault key 稳定。

## 风险点与防护

1. **数据隔离遗漏**：用统一 owner 查询函数 + 参数化跨用户测试 + 直接 id 查询搜索防护。
2. **任务串账**：任务创建时绑定 immutable credential id，worker 不查最新 session。
3. **凭据残留**：凭据集中加密存储，任务只引用 credential，不保存 key 快照，terminal 状态后可清理无引用 credential。
4. **2FA 临时 token 泄漏**：temp token 只存在后端 challenge，不返回前端。
5. **旧数据归属错误**：存在旧数据时强制 `MIGRATION_DEFAULT_OWNER_ID`，不静默归到假 owner。
6. **全局 key 误用**：普通用户生成路径只接受 `UserGenerationConfig`，测试断言不会读取 global provider api_key。
7. **物理文件绕过**：用户媒体只通过受保护 API 访问，前端统一媒体 helper。
8. **余额接口慢或限流**：短 TTL 缓存，失败不阻塞业务页面。
