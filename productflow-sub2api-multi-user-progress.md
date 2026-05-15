# ProductFlow sub2api 多用户改造进度

更新时间：2026-05-15

## 当前结论

改造尚未完成。核心开发已进入收尾阶段，但后端全量测试仍有 21 个失败，必须继续修复后才能认为达成 `productflow-sub2api-multi-user-plan.md` 的要求。

最近一次后端全量测试结果：

- 240 passed
- 21 failed
- 10 warnings
- 命令：`cmd //c "cd /d e:\个人项目\ProductFlow\backend && uv run pytest"`
- 输出文件：`C:\Users\linb6\AppData\Local\Temp\claude\e-------ProductFlow\2d448c06-dee3-4b4c-b417-56db124cf523\tasks\bkrp4psm6.output`

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

最近一次全量测试仍有 21 个失败：

```text
21 failed, 240 passed, 10 warnings
```

失败文件/用例包括：

- `tests/test_auth_settings_runtime_config.py::test_settings_api_requires_secondary_unlock`
- `tests/test_error_handling.py::test_update_copy_set_payload_validation_uses_typed_business_error`
- `tests/test_gallery.py::test_gallery_save_handles_integrity_race`
- `tests/test_image_generation_core.py::test_image_generation_core_normalizes_ids_tool_options_and_reference_payload`
- `tests/test_migrations_database_constraints.py` 中 12 个迁移/模型契约相关失败
- `tests/test_product_crud_jobs.py::test_reference_images_can_be_attached_to_product`
- `tests/test_product_crud_jobs.py::test_product_status_filter_uses_database_pagination_before_eager_loading`
- `tests/test_product_workflow_queue_recovery.py::test_workflow_run_kickoff_reuses_overlapping_active_node_runs`
- `tests/test_provider_payloads.py::test_image_session_openai_responses_uses_explicit_branch_context`
- `tests/test_provider_payloads.py::test_generated_poster_mode_uses_image_provider`

## 已知剩余根因

### 1. `credential_vault_key` 在部分迁移测试环境中缺失

多个 Alembic 迁移测试只设置了旧配置：

- `ADMIN_ACCESS_KEY`
- `SESSION_SECRET`
- `DATABASE_URL`
- `REDIS_URL`
- `STORAGE_ROOT`

但没有设置：

- `CREDENTIAL_VAULT_KEY`

导致 `Settings` 初始化失败：

```text
ValidationError: credential_vault_key Field required
```

下次优先处理方式：

- 给 `credential_vault_key` 提供兼容默认值，或
- 在配置层从 `session_secret` 派生开发/测试默认值，生产环境仍要求显式配置。

需要注意安全约束：生产环境不能静默使用弱默认密钥。

### 2. 应用层旧函数签名仍未完全兼容

仍有旧测试直接调用应用层函数，但新签名要求 `owner_id`。

需要继续补默认 `dev:admin` 的函数包括：

- `add_reference_images`
- `list_products`
- `delete_product`
- `get_product_detail`
- 可能还有 `update_copy_set` / `confirm_copy_set` / `get_product_history` 等。

原则：

- 路由层继续显式传 `current_user.owner_id`，保证真实多用户隔离。
- 仅应用层直接调用保留默认 owner，兼容旧单用户测试。

### 3. Gallery 保存竞态测试还有签名/owner 兼容问题

失败用例：

- `test_gallery_save_handles_integrity_race`

需要检查 `save_generated_asset_to_gallery` 是否仍要求显式 owner，或竞态分支 re-query 时 owner 条件导致旧测试不匹配。

### 4. OpenAI Responses 显式分支上下文测试没有立即生成 rounds

失败用例：

- `test_image_session_openai_responses_uses_explicit_branch_context`

现象：

```text
first.json()["rounds"][-1]
IndexError: list index out of range
```

可能原因：

- 现在 HTTP generate route 走 durable task，只返回 queued session，不同步执行生成。
- 旧测试期望 route 返回时 rounds 已生成。

需要判断是：

- 在测试/mock/同步场景恢复旧同步行为，还是
- 调整任务队列执行触发逻辑让测试中的 monkeypatch 路径能同步完成。

### 5. 迁移契约测试需要细查

迁移相关共有 12 个失败，大部分目前被 `credential_vault_key` 缺失挡住；修复配置后可能暴露真实迁移结构问题。

重点检查：

- `20260515_0029_add_sub2api_multi_user_foundation.py`
- `owner_id` 新列是否和旧 SQLite 迁移兼容。
- 新增索引是否在 downgrade 时完整删除。
- 模型字段与迁移契约是否一致。

## 下次建议接续步骤

1. 先修 `credential_vault_key` 配置兼容。
2. 跑迁移测试子集：
   - `cmd //c "cd /d e:\个人项目\ProductFlow\backend && uv run pytest tests/test_migrations_database_constraints.py -q"`
3. 修应用层旧签名兼容：
   - `add_reference_images`
   - `list_products`
   - `delete_product`
   - `get_product_detail`
   - 相关 copy/history 函数视失败继续补。
4. 跑业务失败子集：
   - `test_product_crud_jobs.py`
   - `test_error_handling.py`
   - `test_gallery.py`
5. 处理 `test_provider_payloads.py::test_image_session_openai_responses_uses_explicit_branch_context` 的同步/异步行为差异。
6. 再跑后端全量测试。
7. 后端全量通过后，跑前端构建：
   - `cmd //c "cd /d e:\个人项目\ProductFlow\web && npm run build"`
8. 若继续修改 UI，最后需要启动前端并手动验证登录、账号页、管理员 settings、普通用户隐藏 settings 等路径。

## 当前 Todo 状态

- 已完成：检查后端全量测试失败范围。
- 进行中：修复多用户迁移导致的剩余后端失败。
- 待办：后端全量通过后重新跑前端 build。

## 重要安全约束

- 浏览器端不能暴露 sub2api access token、临时 token 或 API key。
- 真实用户生成必须使用用户绑定的 sub2api credential。
- 管理员兼容路径只用于旧管理员模式/测试/开发兼容，不应破坏普通用户隔离。
- `credential_vault_key` 在生产环境必须是显式、安全、稳定的配置，不能依赖短弱默认值。
- settings 模块仍必须保持管理员专用，后端也要强制权限校验，不能只依赖前端隐藏。

## 接续提示

下次继续开发时，优先从下面两个点开始：

1. 修 `Settings.credential_vault_key` 的测试/迁移兼容，同时保持生产安全要求。
2. 给剩余应用层直接调用入口补 `owner_id="dev:admin"` 默认值，然后重跑失败子集。
