# Phase 1a W6-A: Memory + Evidence Pack Contract

## Scope

- 仅定义 W6 契约与边界，不在本阶段引入复杂检索/召回策略。
- W5/W6 口径仅覆盖 3 个现有 Skill：
  - `angular-delivery`
  - `angular17-upgrade-regression-handler`
  - `blood-transfusion`
- `jira-requirement-analysis` 作为 investigator 能力复用，不计入 W5 三 Skill 验收。

## Contract Definitions (V1)

- `MemorySchemaV1`
  - `decisions[]`: `key`, `value`, `source_ref`, `producer_agent`, `ts`, `confidence`, `ttl/expires_at`
  - `knowledge_index[]`: `key`, `value`, `trigger_description`, `source_ref`, `ts`
- `EvidencePackV1`
  - `task_id`
  - `intent`
  - `evidences[]`: `source_ref`, `content`, `tool`
  - `assumptions[]`
  - `confidence`

## Naming Rule

- TypeScript 内部对象使用 camelCase（例如 `taskId`, `sourceRef`, `knowledgeIndex`）。
- 导出 JSON / audit / snapshot 使用 snake_case（例如 `task_id`, `source_ref`, `knowledge_index`）。
- 强制提供双向映射测试（camelCase <-> snake_case）。

## Memory Redline

Memory 写入前必须执行红线检查，禁止落库如下数据：

- PHI、真实患者标识
- SSO token
- CA 私钥
- PDA 密钥
- 输血反应原文
- 平台凭证
- `Authorization` / `Bearer` 令牌
- 完整敏感请求/响应报文

## Storage Decision (W6)

- W6 采用 SQLite（本地持久化、单文件、零服务依赖）：
  - 路径固定为 `reports/memory.sqlite`（不入仓）。
  - 满足“真实本地持久化数据库，但不接生产库/外部集中库”约束。
  - 可先用 SQLite 普通检索 / FTS5 / LIKE 跑通 Memory MCP 契约，不被向量能力阻塞。
- 不选 PostgreSQL + pgvector（W6）：
  - 运维和环境前置高，不符合 W6 的最小可运行目标。
  - 当前没有跨项目多写入者/高并发/集中备份刚需。
  - 相关需求推迟到 Phase 4，通过 ADR 再评审是否升级。
