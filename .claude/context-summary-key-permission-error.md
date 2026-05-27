**项目上下文摘要（key 权限错误提示友好化）**

生成时间：2026-05-27 13:30:00

# 1. 相似实现分析

实现1：`backend/src/productflow_backend/application/image_generation_failures.py`
- 模式：遍历异常链，按限流、额度、内容拒绝、连接、超时、5xx、参数错误分类。
- 可复用：`_iter_exception_diagnostics`、`_categorized_failure_decision`、`_contains_sensitive_material`。
- 需注意：供应商原始异常可能包含密钥、URL、提示词或请求体，不能直接暴露。

实现2：`backend/src/productflow_backend/application/product_workflow/image_generation.py`
- 模式：图片 provider 异常先分类，再抛出 `WorkflowSafeExecutionError`，由工作流状态持久化安全文案。
- 可复用：`WorkflowSafeExecutionError` 的安全错误边界。
- 需注意：`TimeLimitExceeded` 必须保留原有超时路径。

实现3：`backend/src/productflow_backend/application/product_workflow/run_state.py`
- 模式：`safe_workflow_failure_reason` 只持久化 `WorkflowSafeExecutionError.safe_message` 或超时文案。
- 可复用：`mark_workflow_run_failed` 会同步写入 run、node、node_run 的失败原因。
- 需注意：普通异常如果直接 `str(exc)` 会泄漏供应商原文。

# 2. 项目约定

命名约定：Python 模块和函数使用 `snake_case`，常量使用大写。
文件组织：供应商错误分类放在 application 层，工作流执行放在 `application/product_workflow/`。
导入顺序：Ruff `I` 规则自动排序。
代码风格：Python 3.12，Ruff 行宽 120。

# 3. 可复用组件清单

`application/image_generation_failures.py`：异常链诊断、敏感信息过滤、失败分类。
`application/product_workflow/run_state.py`：`WorkflowSafeExecutionError` 和工作流失败状态持久化。
`application/product_workflow/execution.py`：文案 provider 调用和重试边界。

# 4. 测试策略

测试框架：pytest。
测试模式：工作流级回归测试，直接注入 fake provider。
参考文件：`backend/tests/test_product_workflow_queue_recovery.py`。
覆盖要求：provider 503 原文不进入 `failure_reason`，run 和 copy node 都展示友好中文提示。

# 5. 依赖和集成点

外部依赖：OpenAI 兼容 provider 可能抛出 HTTP 403/503 或 SDK 包装异常。
内部依赖：工作流执行 -> provider 调用 -> 失败分类 -> `WorkflowSafeExecutionError` -> `mark_workflow_run_failed`。
集成方式：`WorkflowExecutionDependencies` 注入 provider，生产默认由 provider factory 解析。
配置来源：运行时 provider binding、用户 credential、环境变量。

# 6. 技术选型理由

为什么用这个方案：后端持久化前统一清洗，前端所有页面都能拿到同一份友好文案。
优势：不泄漏原始 provider 响应，工作流 run、node、node_run 保持一致。
劣势和风险：不同网关可能把 key 权限伪装成 5xx，只能用可操作提示覆盖权限、额度和网关异常三类。

# 7. 关键风险点

并发问题：无新增并发状态。
边界条件：`TimeLimitExceeded` 保持原路径；业务校验 `ValueError` 仍按既有重试逻辑处理。
性能瓶颈：仅对异常路径遍历异常链，无正常路径开销。
安全考虑：失败原因避免暴露密钥、URL、提示词和供应商原始响应。
