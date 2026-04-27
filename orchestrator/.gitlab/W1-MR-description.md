# W1 骨架初始化

## 变更说明

建立 orchestrator 仓库完整骨架，包含工程治理配置、五大模块类型占位、AGENTS.md v1 及 GitLab CI 三阶段流水线。

## 关联任务

Phase 0 — W1 仓库骨架（见 Notion: Phase 0 — 前置准备 + Harness 骨架 W0-W3）

## 本次 MR 包含

- `pnpm workspace` + TypeScript strict + ESLint flat + Prettier + Vitest + husky pre-commit
- `src/runtime` / `src/gates` / `src/context` / `src/memory` / `src/audit` 类型接口占位
- `AGENTS.md` v1（35 行，含 R1-R9 红线摘要 + turn_state 五态契约）
- `docs/agents/ts-style.md` / `glossary.md` / `redlines.md`
- `.gitlab-ci.yml` lint → typecheck → test 三阶段
- `.gitlab/merge_request_templates/default.md` MR 自检模板

## 自检清单

- [x] `pnpm lint` 通过（0 errors）
- [x] `pnpm typecheck` 通过（0 errors）
- [x] `pnpm test` 通过（smoke test green）
- [x] `AGENTS.md` 主文件 35 行 ≤ 60
- [x] 无 `any` / 无裸 `TODO`
- [x] `.nvmrc` 存在且为 `v22.14.0`
- [x] 五大模块各有 `index.ts` 导出类型定义
- [x] OTel `gen_ai.*` 属性在 `src/audit/index.ts` 注释中标注
- [x] 术语表覆盖 10 个核心术语

## 评审重点

1. `AGENTS.md` 红线 R3/R5/R9 措辞是否与团队红线文档一致（待拍板）
2. `turn_state` 五态语义定义是否完整
3. `src/gates/index.ts` 的 `PolicyLevel` L1/L2/L3 分级是否符合预期
