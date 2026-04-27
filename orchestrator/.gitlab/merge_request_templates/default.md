## 变更说明

<!-- 一句话描述本次 MR 做了什么 -->

## 关联 Issue / 任务

<!-- Closes #xxx 或 Relates to #xxx -->

## 自检清单（合入前逐项勾选）

- [ ] `pnpm lint` 通过
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过
- [ ] `AGENTS.md` 主文件行数 ≤ 60（`wc -l AGENTS.md`）
- [ ] 无 `any` / 无裸 `TODO`（`grep -r 'any\|TODO' src/`）
- [ ] 涉及写操作的变更已通过 Policy Gate L2+ 审批（R3）
- [ ] 新增 tool call 已覆盖 OTel audit 日志（R6）
- [ ] 无敏感数据（密钥/token/内网 IP）进入代码或日志（R7）

## Evidence Pack（如涉及 AI 生成内容）

<!-- input → reasoning → output 链路截图或链接，R4 要求 -->

## 评审重点

<!-- 告诉 reviewer 最需要关注哪里 -->
