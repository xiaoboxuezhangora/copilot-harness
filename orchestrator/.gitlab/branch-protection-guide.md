# GitLab 分支保护建议（手动在 Settings → Repository 配置）

## main 分支

| 设置项 | 推荐值 |
|--------|--------|
| Allowed to push | No one（禁止直接推送） |
| Allowed to merge | Maintainers |
| Require approval before merge | 1 人 |
| Require passing CI pipeline | ✓ |
| Require linear history | ✓（保持 git log 整洁） |
| Code owner approval required | ✓（CODEOWNERS 生效） |

## develop / feature 分支

| 设置项 | 推荐值 |
|--------|--------|
| Allowed to push | Developers + Maintainers |
| Require passing CI pipeline | ✓ |
| Delete branch on merge | ✓ |

## 说明

- W1 阶段团队人数少，1 人 approve 即可；W3+ 可升至 2 人。
- `CODEOWNERS` 已配置为 `@copilot-harness/core-maintainers`，需在 GitLab 创建对应 Group。
- CI pipeline 必须绿才能合入，对应 R5 红线。
