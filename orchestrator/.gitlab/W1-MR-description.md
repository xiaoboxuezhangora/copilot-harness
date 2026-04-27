# W1 骨架初始化

## 变更说明

建立 `copilot-harness` 单仓 monorepo 的 W1 骨架，包含 `orchestrator` 工程治理配置、五大模块类型占位、`AGENTS.md` v1、根级 CI/CODEOWNERS 与单仓 ADR。

## 关联任务

Phase 0 — W1 仓库骨架（Notion: Phase 0 — 前置准备 + Harness 骨架 W0-W3）

## 交付形态调整

原计划要求 `orchestrator` / `skills` / `playbooks` 三个 GitLab 仓库。W1 现在采用一个 GitLab 仓库管理：

- GitLab: <http://10.100.77.238/b.w_neu/copilot-harness>
- `orchestrator/`: TypeScript 编排服务
- `skills/`: `.github/skills/*/SKILL.md`
- `playbooks/`: `.github/playbooks/*.md`

决策记录见 `docs/adr/0001-w1-monorepo.md`。

## 本次 MR 包含

- 根级 `.gitlab-ci.yml` / `CODEOWNERS` / `.gitignore`
- `pnpm workspace` + TypeScript strict + ESLint flat + Prettier + Vitest + husky pre-commit
- `src/runtime` / `src/gates` / `src/context` / `src/memory` / `src/audit` 类型接口占位
- `AGENTS.md` v1（35 行，含 R1-R9 红线摘要 + turn_state 五态契约）
- `docs/agents/ts-style.md` / `glossary.md` / `redlines.md`
- `.gitlab/merge_request_templates/default.md` MR 自检模板

## 自检清单

- [ ] `pnpm --dir orchestrator format:check` 通过
- [ ] `pnpm --dir orchestrator lint` 通过
- [ ] `pnpm --dir orchestrator typecheck` 通过
- [ ] `pnpm --dir orchestrator test` 通过
- [ ] `AGENTS.md` 主文件 35 行 <= 60
- [ ] 无 `any` / 无裸 `TODO`
- [ ] `.nvmrc` 存在且为 `v22.14.0`
- [ ] 五大模块各有 `index.ts` 导出类型定义
- [ ] OTel `gen_ai.*` 属性在 `src/audit/index.ts` 注释中标注
- [ ] 术语表覆盖 10 个核心术语

## 需人工补证

- [ ] GitLab MR 链接
- [ ] GitLab CI 绿链接或截图
- [ ] GitLab branch protection 配置截图

## 评审重点

1. 单仓 monorepo 决策是否符合 W1-W3 推进节奏。
2. `AGENTS.md` 红线 R3/R5/R9 措辞是否与团队红线文档一致。
3. `turn_state` 五态语义定义是否完整。
