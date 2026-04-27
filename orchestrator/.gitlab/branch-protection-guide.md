# GitLab 分支保护建议（手动在 Settings -> Repository 配置）

目标仓库：<http://10.100.77.238/b.w_neu/copilot-harness>

## main 分支

| 设置项                        | 推荐值                          |
| ----------------------------- | ------------------------------- |
| Allowed to push               | No one（禁止直接推送）          |
| Allowed to merge              | Maintainers                     |
| Require approval before merge | 1 人                            |
| Require passing CI pipeline   | enabled                         |
| Require linear history        | enabled（保持 git log 整洁）    |
| Code owner approval required  | enabled（根级 CODEOWNERS 生效） |

## develop / feature 分支

| 设置项                      | 推荐值                   |
| --------------------------- | ------------------------ |
| Allowed to push             | Developers + Maintainers |
| Require passing CI pipeline | enabled                  |
| Delete branch on merge      | enabled                  |

## 说明

- W1 阶段团队人数少，1 人 approve 即可；W3+ 可升至 2 人。
- 根级 `CODEOWNERS` 已按 `orchestrator/`、`skills/`、`playbooks/` 分区配置为 `@copilot-harness/core-maintainers`，需在 GitLab 创建对应 Group。
- CI pipeline 必须绿才能合入，对应 R5 红线。
