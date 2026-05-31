# Business Skill Management Standard

更新时间：2026-05-28

## 结论

截至 2026-05，市面上的 Skill 协议没有完全闭合，也不是各家厂商完全相同。

- `SKILL.md` / Agent Skills 形态已经在代码 Agent 场景明显收敛，Anthropic Claude Skills、GitHub Copilot agent skills、Google ADK Skills 都采用或兼容 folder + `SKILL.md` + references/scripts/assets 的分层加载思想。
- MCP 已基本成为工具、资源、提示和 server 能力边界的共享协议，但 MCP 不是业务 Skill 定义协议。
- OpenAI GPTs / Agents、Microsoft 365 Copilot declarative agents、Gemini Gems 仍然是各自平台的 instructions、knowledge、actions、manifest 或 UI 托管模型，不能直接视作同一 Skill 包格式。

因此本项目采用内部 Canonical Business Skill Model，并通过导出适配器生成目标厂商格式。

## 外部协议观察

| 方向 | 2026-05 状态 | 对本项目的影响 |
|---|---|---|
| Agent Skills / `SKILL.md` | 收敛中 | 作为优先导出格式，保留 progressive disclosure、references、scripts、assets。 |
| MCP | 已收敛到工具/资源/提示协议 | Skill 中只声明 MCP allowlist 和 side-effect 边界，不把 MCP 当 Skill 本体。 |
| OpenAI GPTs / Agents | 厂商特定 | 从 Canonical Skill 导出 instructions、knowledge 文件清单、tool/action 描述和 guardrails。 |
| Microsoft 365 Copilot | 厂商特定 | 从 Canonical Skill 导出 declarative agent manifest 所需字段。 |
| Gemini Gems / Google ADK | 混合 | ADK 可适配 Agent Skills；Gems 需导出精简说明和知识包。 |

参考来源：

- Anthropic Claude Skills: <https://claude.com/docs/skills/overview>
- GitHub Copilot agent skills: <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills>
- Google ADK Skills: <https://adk.dev/skills/>
- MCP specification: <https://modelcontextprotocol.io/specification>
- OpenAI GPTs: <https://help.openai.com/en/articles/8843948-knowledge-in-gpts>
- OpenAI Agents SDK: <https://openai.github.io/openai-agents-js/>
- Microsoft 365 Copilot declarative agents: <https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-declarative-agent>
- Gemini Gems: <https://support.google.com/gemini/answer/15236321>

## Canonical Business Skill Model

内部 Skill 标准字段：

| 字段 | 含义 |
|---|---|
| `id/name/version/status/owner` | 可维护资产身份、生命周期与责任人。 |
| `description` | Skill 能力边界，保持短而清晰。 |
| `positiveTriggers` | 正触发规则，决定何时加载或推荐。 |
| `negativeTriggers` | 反触发规则，避免误触发和过度泛化。 |
| `keywords` | 快速召回关键词，可由语义资产持续优化。 |
| `defaultAgents/defaultWorkflow` | 推荐 Agent 和默认编排链路。 |
| `repositoryTargets` | 默认代码检索仓库、分支、模块与原因。 |
| `mcpAllowList` | 允许的 MCP 能力边界。 |
| `requiredInputs` | 进入分析或实施前必须具备的输入。 |
| `guardrails` | 安全、证据、实施边界。 |
| `requiredOutputs` | 每次使用后必须产出的结构。 |
| `referenceFiles` | progressive disclosure 的 references。 |
| `exportTargets` | 可导出的目标协议。 |
| `quality` | 命中率、修正率、复用次数和评估时间。 |
| `semanticAssets` | 从 Jira、MR Review、Eval、Agent trace、人工确认沉淀的可晋升资产。 |

当前实现位置：

- Catalog 与协议矩阵：[orchestrator/src/skills/catalog.ts](/Users/wangbo/own/copilot-harness/orchestrator/src/skills/catalog.ts)
- 导出适配器：[orchestrator/src/skills/exporters.ts](/Users/wangbo/own/copilot-harness/orchestrator/src/skills/exporters.ts)
- Showcase 管理页：[apps/showcase/src/App.vue](/Users/wangbo/own/copilot-harness/apps/showcase/src/App.vue)

## 导出策略

| 目标 | 导出结果 |
|---|---|
| Claude / GitHub Copilot / Google ADK Skills | `skill-id/SKILL.md`，保留 frontmatter、正文、references。 |
| OpenAI GPT / Agents | JSON 包，包含 instructions、knowledgeFiles、tools、metadata。 |
| Microsoft 365 Copilot | declarative-agent 风格 JSON，包含 instructions、capabilities、actions、knowledge。 |
| Gemini Gems | 从内部模型生成精简 instructions 与知识包；Google ADK 走 Agent Skills。 |
| MCP | 只导出 allowlist / side-effect policy，不导出为 Skill 本体。 |

## 语义资产闭环

业务 Skill 需要能通过真实使用不断优化。闭环如下：

1. Agent 使用 Skill 处理 Jira / MR / Eval 样本。
2. 审计日志、MR review、人工修正、失败样本进入 pending semantic assets。
3. Skill 管理页展示候选资产，人工确认是否晋升。
4. 晋升后更新 Canonical Skill 的触发规则、反触发规则、guardrails、reference 或 templates。
5. Eval 检查命中率、误触发率、修正率和输出质量。
6. 通过后再导出到厂商协议。

晋升门槛：

- 必须有 source ref 或审计证据。
- 不能只来自单次偶然成功；至少需要人工确认或 Eval 样本支持。
- 影响正触发/反触发的改动必须检查误触发风险。
- 涉及安全、病案、收费、CA 签名等红线时必须走 PolicyGate。

## Angular17 Skill 标准化口径

`angular17-upgrade-regression-handler` 是当前首个业务 Skill 管理样例：

- 默认仓库：`apmis/odcbs/odcbs-frontend`
- 默认分支：`develop_to_angular17`
- 默认链路：需求澄清 → 影响面分析 → Angular17 分析 → 代码检索 → 方案生成
- 典型语义资产：图标色差 DOM evidence、overlay/table 时序、dynamic-form 布局回归、ng-zorro table width source-of-truth

运行侧已把 Angular17 描述动态加载到 investigator Skill 列表；Showcase 侧可维护触发/反触发、关键词、MCP 白名单、references、导出预览和语义资产候选。
