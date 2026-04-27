# TypeScript 编码规范（详细版）

## 1. 类型系统
- 全仓开启 strict 模式，禁止 `any`。
- 不确定输入使用 `unknown`，通过 type guard 收敛。
- 公共边界（MCP、HTTP、CLI）必须显式定义请求/响应类型。

## 2. 命名与结构
- 变量/函数：camelCase。
- 类型/接口/类：PascalCase。
- 常量：UPPER_SNAKE_CASE。
- 每个模块通过 `index.ts` 统一导出公共接口。

## 3. 异步与并发
- 异步逻辑统一使用 async/await，禁止裸 `.then()` 链。
- 并发任务必须包含超时、重试上限与取消语义。

## 4. 错误处理
- 使用自定义 Error 继承体系（如 `PolicyGateError`、`ValidationError`）。
- 禁止 `catch (e: any)`，统一 `catch (error: unknown)` 并做类型收敛。
- 错误消息禁止包含密钥、token、内网地址等敏感信息。

## 5. 可测试性
- 逻辑层优先纯函数化；I/O 与副作用通过接口注入。
- 单元测试覆盖成功、失败、边界三类路径。

## 6. 代码风格
- 统一 ESLint + Prettier；提交前必须通过 lint、typecheck。
- 文件编码 UTF-8，换行符 LF。
