# Requirements Analysis / Jira 需求分型体系

Generated: 2026-05-27

本文档汇总当前项目里 Jira 需求分析、需求分型、门禁判断，以及“实现代码是否满足需求目标”的判定链路。它是对
`docs/requirements-analysis-upgrade-w1.md` 至 `docs/requirements-analysis-upgrade-w7.md` 的综合说明，
不替代这些历史验收证据。

## 结论

当前系统不是用一个单点模型直接判断“代码是否已经实现了需求”。它采用证据驱动的分层门禁：

```text
JiraEvidencePackV2
  -> IssueTypeRouterResult
  -> RequirementProfileSpecV0
  -> RequirementGateResultV0
  -> CodeImpactReportV0(beta)
  -> Resolver / Draft MR / Playbook shadow review
  -> CI, eval replay, human review
```

其中：

- `RequirementGateResultV0` 判断需求是否具备进入实现的条件。
- `CodeImpactReportV0(beta)` 检查代码变更是否能被需求目标、范围和测试证据解释。
- Resolver、Draft MR、Playbook、CI 和人工 review 共同提供实现后的审查闭环。

因此，`implementation_ready = green` 不等价于“代码已经实现需求”，而是表示需求信息足够完整，可以进入受控实现和
审查流程。真正的实现满足度需要结合代码影响分析、测试证据、MR review 和人工确认。

## 设计边界

Requirements Analysis 当前仍处于 read-only / shadow-first 边界内：

- 不直接写 Jira。
- 不自动创建或合并 MR。
- 不把 beta 级 CodeImpact 作为阻塞门禁。
- 不伪造缺失证据；所有关键判断必须能回溯到 `sourceRef`。
- 不把 unsupported profile 当作可实现需求放行。

该边界让系统可以先稳定生产可审查证据，再逐步升级为更强的执行门禁。

## W1: Jira Evidence Pack v2

W1 的目标是把 Jira issue 转换成稳定、可回放、可引用的证据包。

核心产物：

- 实现：`orchestrator/src/jira/evidence.ts`
- 文档：`docs/requirements-analysis-upgrade-w1.md`

`JiraEvidencePackV2` 负责归一化以下信息：

- issue 基础字段：summary、description、labels、components、priority、assignee 等。
- 关键业务字段：版本、模块、缺陷类别、需求发布状态、工时字段等。
- comments、attachments、links、changelog 等上下文。
- 每个可用字段的 `sourceRef`。

设计重点不是“猜需求”，而是先固定证据输入。后续 Router、Profile、Gate、CodeImpact 都只能基于 Evidence Pack
中可追溯的信息做判断。

## W2: Issue Type Router

W2 的目标是把 Jira 需求分到可执行的需求类型。

核心产物：

- 实现：`orchestrator/src/requirements/router.ts`
- 文档：`docs/requirements-analysis-upgrade-w2.md`

当前路由输出为 `IssueTypeRouterResult`，主要识别：

- `visual`: UI、页面、样式、交互、视觉验收类需求。
- `integration`: API、服务、字段映射、第三方系统、数据同步类需求。
- `workflow`: 状态流转、审批、任务处理、业务流程类需求。
- `unsupported`: 证据不足或不在当前分型能力范围内。

Router 通过关键词、字段、components、labels、description、comments 等信号计分。它的职责是给出候选 profile、
置信度、命中证据和缺口，而不是直接生成实现方案。

## W3: Requirement Profile Spec

W3 的目标是把分型结果变成 profile-specific 的结构化需求规格。

核心产物：

- 实现：`orchestrator/src/requirements/profiles.ts`
- 文档：`docs/requirements-analysis-upgrade-w3.md`

`RequirementProfileSpecV0` 会按 profile 抽取不同的实现约束：

- `visual`: UI surface、视觉状态、交互、验收截图或页面入口。
- `integration`: 上下游系统、接口、字段映射、错误处理、数据契约。
- `workflow`: 状态、角色、触发条件、流转规则、异常路径。

如果 router 结果为 `unsupported`，Profile Spec 必须保持不可实现状态，并输出缺口。这个设计避免系统在需求类型不清楚时
提前编造实现路径。

## W4: Requirement Gate

W4 的目标是判断需求是否已经具备进入实现的条件。

核心产物：

- 实现：`orchestrator/src/requirements/gate.ts`
- 文档：`docs/requirements-analysis-upgrade-w4.md`

`RequirementGateResultV0` 使用六个轴做判定：

- `goal`: 目标是否清晰。
- `evidence`: 是否有足够 Jira 证据。
- `scope`: 范围、模块、边界是否明确。
- `testability`: 是否能形成验收或测试计划。
- `profile`: 分型和 profile spec 是否可信。
- `policy`: 是否满足只读、证据、风险等策略约束。

Gate 输出通常包含：

- `investigation_ready`: 是否足够进入进一步调查。
- `implementation_ready`: 是否足够进入实现规划。
- `gaps`: 当前阻塞或待补证据。
- `hardBlocks`: 不能绕过的硬阻塞。
- `sourceRefs`: 支撑判定的证据引用。

这一步是需求分析的主门禁。它判断“是否能开始实现”，不判断“代码是否已经完成实现”。

## W5: Eval Replay

W5 的目标是用样本集回放验证 W1-W4 的稳定性。

核心产物：

- 实现：`orchestrator/src/requirements/eval.ts`
- 文档：`docs/requirements-analysis-upgrade-w5.md`
- 样本：`orchestrator/fixtures/requirements/requirements-eval-v0-samples.json`
- 报告：`orchestrator/eval/requirements-analysis-v0-report.json`

Eval 会检查：

- router profile 是否符合预期。
- gate readiness 是否符合预期。
- 缺口分类是否稳定。
- 是否出现应阻塞但被放行的样本。

当样本出现 `NOT_READY` 或关键分类失败时，表示需求分析链路本身需要调整，不能盲目进入实现自动化。

## W6: Showcase Evidence Surface

W6 的目标是把需求分析结果展示到 Showcase，使人可以检查证据、分型、门禁和 replay 结果。

核心文档：

- `docs/requirements-analysis-upgrade-w6.md`

Showcase 不改变需求分析结果，只是把 evidence、profile、gate、eval summary 作为只读面板呈现。它的价值是让
管理者和工程师能看到系统为什么判定一个 Jira 可实现或不可实现。

## W7: Code Impact beta

W7 的目标是补上“代码变更是否覆盖需求目标”的 beta 级分析能力。

核心产物：

- 实现：`orchestrator/src/requirements/codeImpact.ts`
- 文档：`docs/requirements-analysis-upgrade-w7.md`

`CodeImpactReportV0` 会结合 Requirement Gate、profile spec、代码变更目标和 evidence，输出以下维度：

- `target`: 是否有明确代码目标。
- `coverage`: 变更是否覆盖需求涉及的 surface。
- `risk`: 是否引入较高实现风险。
- `tests`: 是否有测试或验收证据。
- `traceability`: 代码变更是否能回溯到需求证据。
- `review`: 是否需要人工补审。

当代码证据不足时，CodeImpact 会返回 `need_more_context`。这不是失败的语义证明，而是说明当前代码影响证据不足以支持
“实现已覆盖需求”的结论。

目前 CodeImpact 是 beta：

- 可以作为 review 辅助。
- 可以暴露变更与需求之间的缺口。
- 不能单独作为合并阻塞或自动放行依据。

## Jira / GitLab Context Planning

需求分析之后，系统还有 Jira 与 GitLab 上下文规划阶段。

核心产物：

- 实现：`orchestrator/src/jira/context.ts`

该阶段把需求证据转成调查计划：

- Stage 1 生成需要查询的 Jira、GitLab、本地文件、CI 等证据请求。
- Stage 2 基于返回证据生成 `draft_plan`、风险、测试建议和未决问题。
- validator 要求关键计划必须引用 `jira`、`gitlab` 或 `local` sourceRef。

这里仍然是 planning，不是实现。它的职责是把“需求可实现”进一步细化成“应该查哪些代码、改哪些区域、如何验收”。

## Resolver / Draft MR / Playbook Shadow Review

实现前后还有三层下游审查辅助。

Resolver：

- 实现：`orchestrator/src/resolver/index.ts`
- 根据证据和风险输出 `next_action`。
- 当缺少问题、证据或测试计划时，倾向于要求继续澄清。

Draft MR：

- 实现：`orchestrator/src/draftMr/index.ts`
- 生成 MR 摘要、测试计划、review checklist 和不确定性说明。
- 有 write guard，避免在不满足边界时执行写操作。

Playbook：

- 实现：`orchestrator/src/playbooks/index.ts`
- 用 shadow run 分类成功、失败、阻塞、需人工处理等状态。
- 要求输入和输出继续保持 sourceRef 约束。

这三层共同回答：“这个实现计划和变更是否有足够证据进入 review”，而不是绕过 review 自动证明实现正确。

## 判断实现代码是否满足需求目标

当前项目采用以下组合判断：

1. 需求证据是否完整：由 Evidence Pack、Router、Profile Spec 和 Requirement Gate 判断。
2. 实现范围是否对应需求：由 Jira/GitLab planning 和 CodeImpact beta 检查。
3. 测试与验收是否覆盖目标：由 ReqGate testability、CodeImpact tests、Draft MR test plan 和 CI 结果共同判断。
4. 风险是否可接受：由 ReqGate policy、Resolver risk、CodeImpact risk 和 Playbook run status 共同判断。
5. 是否可审查：由 sourceRef、MR checklist、eval replay 和人工 review 判断。

因此，系统的判定逻辑是“可追溯证据 + 结构化门禁 + 代码影响分析 + 测试结果 + 人工确认”。缺少任一关键证据时，系统应该输出
gap 或 `need_more_context`，而不是生成确定性通过结论。

## 维护规则

- 新增 profile 时，必须同步更新 router、profile spec、gate、fixtures、eval 和 Showcase 展示。
- 修改 gate 规则时，必须补充 replay 样本，避免 readiness 漂移。
- 修改 CodeImpact 规则时，必须保持 beta 边界，除非另有明确 cutover 文档。
- 新增下游自动化能力前，必须继续保留 sourceRef 和 write guard。
- 不要把 W1-W7 历史文档改写成当前总结；当前总结应维护在 `docs/framework/` 下。
