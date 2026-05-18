# ProductFlow sub2api 多用户改造进度

更新时间：2026-05-15

## 当前结论

改造后端部分已完成并通过全量测试，前端构建已通过。Docker Compose 生产栈已能启动并保持健康；真实 sub2api 地址已配置，生产链路已验证到登录、用户 API key、settings、图像会话创建和生成资产。

最近一次生产栈验证结果：

- `productflow-backend`：healthy，`GET /healthz` 返回 `{"status":"ok"}`
- `productflow-web`：healthy，访问 Web 可进入已登录后的 `/products`
- 未登录会话：`GET /api/auth/session` 返回 `{"authenticated":false,"access_required":true}`
- sub2api 公共配置：`GET /api/auth/public-settings` 返回 200，`site_name` 为 `智惠 API (ZHAPI)`
- 浏览器会话：`authenticated=true`，`owner_prefix=sub2api`，`api_key_source=sub2api`，`api_key_status=available`
- 管理员兼容会话：`POST /api/auth/session`、`GET /api/auth/session`、`GET /api/account` 均返回 200
- settings：管理员 session 可访问 `GET /api/settings/runtime`，真实浏览器会话已访问 settings/provider config 并更新 provider bindings
- 图像生成：生产环境中存在 1 个 image session，包含 1 个 round、1 个顶层 asset、1 个 `generated_asset`，preview/thumbnail 下载均返回 200

最近一次后端全量测试结果：

- 261 passed
- 25 warnings
- 命令：`cmd /c "cd /d "g:\我的项目\ProductFlow\backend" && uv run --extra dev pytest -q"`

最近一次前端构建状态：

- 依赖安装：已完成 `pnpm install`
- 构建命令：`cmd /c "cd /d "g:\我的项目\ProductFlow\web" && npm run build"`
- 结果：通过，`✓ built in 2.27s`

## 已完成的主要工作

### 1. 计划落地

- 已将计划文件复制到项目根目录：`productflow-sub2api-multi-user-plan.md`
- 当前开发目标是按该计划完成 ProductFlow 多用户化与 sub2api 深度集成。

### 2. 后端认证与凭据基础

已实现或接近完成：

- 新增 sub2api 客户端，用于登录、注册、2FA、验证码、Key、余额/用量查询。
- 新增 `productflow_session` HttpOnly cookie 会话机制。
- 新增后端加密凭据仓库，使用 `credential_vault_key` 派生密钥并加密：
  - sub2api access token
  - sub2api API key
  - 2FA 临时 token
- 新增认证相关表：
  - `auth_sessions`
  - `auth_login_challenges`
  - `user_provider_credentials`
- 浏览器端不暴露 access token、临时 token 或 API key。

### 3. 管理员兼容登录

为兼容旧测试和旧管理员模式，已恢复：

- `POST /api/auth/session`
- 支持旧的 `admin_key` 登录方式。
- 管理员兼容会话使用本地 `AuthSession`。
- 修复了 SQLite 返回 naive datetime 导致会话过期比较崩溃的问题。
- 关闭 `admin_access_required` 时，恢复旧版最小 session JSON：
  - `{"authenticated": true, "access_required": false}`
- 未登录且访问控制重新启用时，恢复旧版最小 session JSON：
  - `{"authenticated": false, "access_required": true}`

### 4. 多租户 owner 隔离

已为核心业务对象引入 owner 维度，路由层按当前用户 owner 过滤：

- products
- image sessions
- image session generation tasks
- gallery entries
- user canvas templates
- product workflows / workflow runs

同时为了兼容旧测试，部分 ORM/model 和应用层入口已临时提供 `dev:admin` 默认 owner。

### 5. 生成任务绑定用户凭据

已完成主要链路：

- 连续生图任务记录 owner、sub2api 用户、credential、provider base URL、key fingerprint。
- Workflow run 记录 owner、sub2api 用户、credential、provider base URL、key fingerprint。
- 后台执行时优先使用任务/run 绑定的 credential，而不是全局 provider API key。
- mock provider 场景下不强制要求 API key，避免旧测试和开发模式被阻断。

### 6. 前端认证与账号页面

已完成：

- 登录页从旧管理员 key 登录改为 sub2api 登录/注册/2FA 流程。
- 新增账号页，展示：
  - sub2api 用户信息
  - API key 状态
  - provider key fingerprint
  - 余额/用量 JSON
- settings 路由和导航项改为管理员可见/可访问。
- 顶部导航新增账号入口。
- 前端构建曾通过一次：
  - `cmd //c "cd /d e:\个人项目\ProductFlow\web && npm run build"`

## 最近已修复的问题

- 旧测试调用 `POST /api/auth/session` 返回 405。
  - 已补兼容 route。
- SQLite datetime naive/aware 比较报错。
  - 已新增 `as_utc()` 并用于会话与 settings unlock 比较。
- 管理员兼容登录没有 API key 导致 mock 生成测试返回 409。
  - 已允许管理员/mock provider 路径不强制 credential。
- 旧测试直接实例化 `ImageSession` 等对象时缺少 owner_id。
  - 已给若干模型 owner 字段提供 `dev:admin` 默认值。
- 旧测试直接调用部分应用层函数时缺少 owner_id。
  - 已开始为应用层入口提供默认 `dev:admin`。
- 关闭管理员访问时 session/setting unlock 兼容行为不一致。
  - 已修复关键回归测试。

已通过的关键针对性回归测试：

- `tests/test_auth_settings_runtime_config.py::test_admin_access_can_be_disabled_and_re_enabled`
- `tests/test_error_handling.py::test_high_risk_business_paths_raise_typed_validation_errors`
- `tests/test_generation_admission.py::test_generation_cap_accepts_and_queues_image_session_generation_task_creation`
- `tests/test_gallery.py::test_gallery_rejects_generated_asset_without_round`

## 当前剩余失败

后端暂无剩余失败：

```text
261 passed, 25 warnings
```

前端最终构建已通过。

## 已关闭的历史阻塞

以下问题曾在多用户改造中阻塞测试或生产验证，当前均已关闭：

- `credential_vault_key` 配置兼容：测试/开发环境可启动，生产仍要求显式、安全、稳定的密钥。
- 多用户迁移与模型契约：迁移测试已恢复通过。
- 应用层旧调用入口的 `dev:admin` 默认 owner：兼容旧测试，路由层仍显式传 `current_user.owner_id` 保证真实多用户隔离。
- Gallery 保存竞态测试的 owner 兼容问题。
- OpenAI Responses 显式分支上下文测试与 durable task 行为差异。
- 管理员兼容路径下 mock/openai provider 任务凭据兼容。

## 下次建议接续步骤

1. 继续生产环境真实用户路径验证：注册、登录、2FA、账号页余额/用量、用户绑定 API key 生成。
2. 继续验证权限隔离：普通用户隐藏并拒绝访问 settings，管理员 settings 仍需二次解锁，跨 owner 数据访问返回未找到。
3. 如修改 UI，最后需要启动前端并手动验证登录、账号页、管理员 settings、普通用户隐藏 settings 等路径。
4. 在继续功能开发前，优先补普通用户 settings 拒绝、管理员二次解锁、账号页余额/用量和用户 API key 状态的前端/后端回归覆盖。

## 当前 Todo 状态

- 已完成：修复 `credential_vault_key` 配置兼容。
- 已完成：修复多用户迁移与模型契约测试。
- 已完成：补应用层旧调用入口的 `dev:admin` 默认 owner。
- 已完成：修复 settings 重新登录解锁状态兼容。
- 已完成：修复管理员兼容路径下 mock/openai provider 任务凭据兼容。
- 已完成：后端全量测试通过。
- 已完成：前端 `npm run build` 通过。
- 已完成：Docker Compose 生产栈接入真实 sub2api 地址并恢复 healthy。
- 已完成：同步现有 PostgreSQL volume 用户密码到当前 `.env` 的 `POSTGRES_PASSWORD`，未删除数据卷。
- 已完成：生产环境真实 sub2api 登录、用户 API key、settings、图像会话创建和生成资产验证。

## 重要安全约束

- 浏览器端不能暴露 sub2api access token、临时 token 或 API key。
- 真实用户生成必须使用用户绑定的 sub2api credential。
- 管理员兼容路径只用于旧管理员模式/测试/开发兼容，不应破坏普通用户隔离。
- `credential_vault_key` 在生产环境必须是显式、安全、稳定的配置，不能依赖短弱默认值。
- settings 模块仍必须保持管理员专用，后端也要强制权限校验，不能只依赖前端隐藏。

## 接续提示

下次继续生产测试时，优先从下面三点开始：

1. 在生产 `.env` 或启动环境中提供真实 `SUB2API_AUTH_BASE_URL` 与 `SUB2API_PROVIDER_BASE_URL`。
2. 用同一组稳定生产密钥重建/重启 backend 与 worker，确认 `docker compose config` 和健康检查通过。
3. 继续验证真实用户注册/登录、2FA、账号页余额/用量、用户绑定 API key 生成、管理员 settings 权限隔离。
