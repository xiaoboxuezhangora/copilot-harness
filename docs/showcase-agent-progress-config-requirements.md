# AI 开发中枢 · Agent 编排可视化与系统配置需求整理

版本：v0.1  
日期：2026-05-16  
适用范围：`apps/showcase` 前端后续迭代  
关联页面：Jira 调度与治理驾驶舱  
目标用户：研发主管、项目经理、产品负责人、平台管理员

## 1. 背景

当前页面已经支持从 Jira 队列进入 Skill 编排，并可把任务推进到「Agent 执行中」状态。但进入 Agent 编排/执行阶段后，用户只能看到任务处于某个流水线列或右侧抽屉的简要步骤状态，看不到更细的执行进展，也无法判断什么时候完成、当前卡在哪里、是否需要人工介入。

同时，左侧「配置」模块目前显示暂未开发，但实际业务需要在系统内配置 Jira、GitLab、代码检索、MCP、Agent 执行参数等基础信息，否则 Jira 到代码分析、MR、证据链、Agent 执行无法从演示走向真实可用。

## 2. 核心问题

### 2.1 Agent 编排阶段信息不足

当前问题：

- Jira 进入「Agent 执行中」后，只能看到状态名。
- 不知道当前 Agent 正在执行哪个 Skill。
- 不知道预计完成时间、已耗时、剩余时间。
- 不知道当前执行步骤是否阻塞、失败、等待人工输入。
- 没有持续日志、心跳、Trace、产物进度。
- Pipeline 卡片无法解释为什么任务停在当前阶段。

业务影响：

- 研发主管无法判断任务是否正常推进。
- 项目经理无法预估交付时间。
- 高风险任务无法及时介入。
- 用户会误以为系统已经失去响应。

### 2.2 配置能力缺失

当前问题：

- 「配置」入口尚未提供可操作页面。
- Jira 地址、认证、项目、保存筛选器、自定义字段无法配置。
- GitLab 地址、Token、工程映射、分支规则无法配置。
- MCP 白名单、超时、重试、预算、并发等运行参数无法配置。
- Angular17 等业务规则只能写在代码或文档中，无法页面化维护。

业务影响：

- 无法迁移到不同项目、不同 Jira/GitLab 环境。
- 无法解释代码分析使用了哪个仓库和分支。
- 配置错误只能靠代码排查，无法由平台管理员自助修复。

## 3. 产品目标

本次需求分为两个模块：

1. Agent 编排可视化：让用户在 Jira 进入 Agent 编排后，看得见进度、ETA、当前步骤、阻塞原因、日志和产物。
2. 系统配置中心：让管理员可以配置 Jira、GitLab、MCP、Agent、业务规则和安全策略。

最终用户应能回答：

- 这个 Jira 当前由哪个 Agent 在执行？
- 正在执行哪个 Skill？
- 预计什么时候完成？
- 当前是否阻塞，阻塞原因是什么？
- 代码分析查的是哪个 GitLab 工程、哪个分支？
- Jira/GitLab/MCP 的连接信息在哪里配置和校验？

## 4. 范围定义

### 4.1 本期范围

- 增强 Pipeline 和右侧抽屉的 Agent 执行信息。
- 新增 Agent 执行详情区域。
- 新增预计完成时间、已耗时、剩余时间、进度百分比。
- 新增步骤级状态：等待、运行中、成功、失败、阻塞、等待人工确认。
- 新增执行日志和产物列表。
- 新增配置页面的信息架构和字段设计。
- 支持 Jira、GitLab、代码检索、MCP、Agent、业务 Skill 规则配置。
- 支持连接测试和配置状态反馈。

### 4.2 暂不纳入

- 真正存储密钥的后端安全实现。
- 真实调用 Jira/GitLab 的后端接口实现。
- 多租户权限系统完整实现。
- Agent 执行引擎本身的调度算法。
- 完整告警系统和消息推送。

## 5. 用户角色

| 角色 | 关注点 |
| --- | --- |
| 研发主管 | 当前任务是否按计划执行，哪些需要介入 |
| 项目经理 | 预计完成时间、阻塞、交付风险 |
| 开发负责人 | 代码分析范围、分支、MR、验证命令 |
| 平台管理员 | Jira/GitLab/MCP/Agent 配置和连接健康 |
| 产品负责人 | 高优先级需求是否已进入正确执行链路 |

## 6. Agent 编排可视化需求

### 6.1 Pipeline 卡片增强

当前 Pipeline 卡片需要从「状态标签」升级为「执行摘要卡」。

每张卡片应展示：

| 字段 | 说明 |
| --- | --- |
| Jira Key | 任务编号 |
| Summary | 任务摘要 |
| 当前状态 | 待编排、Skill 已分配、Agent 执行中、MR 待 Review、等待人工确认等 |
| 当前 Agent | 当前执行角色，例如 Angular Expert、Impact Analyst |
| 当前 Skill | 当前执行 Skill，例如 Angular17 升级回归分析 |
| 进度 | 百分比或步骤完成数 |
| 预计完成 | 预计完成时间，例如 14:35 |
| 已耗时 | 从触发开始到现在的时间 |
| 剩余时间 | 预计剩余分钟数 |
| 阻塞标记 | 有阻塞时显示原因摘要 |

交互：

- 点击卡片打开右侧抽屉「执行步骤」页签。
- 点击状态/进度区域可打开执行详情。
- 如果失败或阻塞，卡片应使用红/橙色风险提示。

### 6.2 右侧抽屉新增执行总览

在右侧抽屉「执行步骤」页签顶部新增「Agent 执行总览」。

展示字段：

| 字段 | 说明 |
| --- | --- |
| Run ID | Agent 执行实例 ID |
| 当前阶段 | 当前所处 Skill/步骤 |
| 当前 Agent | 执行 Agent |
| 开始时间 | 触发执行时间 |
| 最近心跳 | Agent 最近上报时间 |
| 预计完成 | 根据 Skill 预算和历史耗时计算 |
| SLA | 当前任务是否超出预期 |
| 进度 | 完成步骤 / 总步骤 |
| 状态 | running / blocked / failed / waiting_review / completed |

### 6.3 步骤级进度

每个 Skill 执行步骤应展示：

- 步骤名称。
- 所属 Skill。
- 执行 Agent。
- 输入来源。
- 输出产物。
- 开始时间。
- 结束时间。
- 预计耗时。
- 实际耗时。
- 状态。
- 失败或阻塞原因。

状态定义：

| 状态 | 含义 | UI 表达 |
| --- | --- | --- |
| pending | 等待执行 | 灰色 |
| running | 正在执行 | 蓝色 + 动态进度 |
| ok | 已完成 | 绿色 |
| blocked | 阻塞 | 橙色 |
| failed | 失败 | 红色 |
| waiting_human | 等待人工确认 | 橙色 + 操作按钮 |

### 6.4 执行日志

执行详情中需要展示时间线日志。

日志字段：

- 时间。
- 来源：Agent / MCP / System / Human。
- 级别：info / warn / error。
- 内容。
- 关联产物。

示例：

```text
14:21 Impact Analyst 开始执行影响面分析
14:22 GitLabReader 检索 apmis/odcbs/odcbs-frontend@develop_to_angular17
14:23 命中 shared/icon 和 anesthesia-fee/batch-edit 相关文件
14:25 输出影响面报告，等待方案生成
```

### 6.5 预计完成时间

预计完成时间应由以下信息计算：

- 当前 Skill 预计耗时。
- 已完成步骤实际耗时。
- 待执行步骤预算。
- Agent 排队时间。
- 当前失败/阻塞重试次数。
- 系统并发限制。

展示规则：

- 正常任务：显示「预计完成 14:35 · 剩余 12m」。
- 不确定任务：显示「预计完成待计算 · 缺少 Agent 心跳」。
- 阻塞任务：显示「已阻塞 8m · 等待人工确认」。
- 超时任务：显示「已超预计 5m」。

### 6.6 人工介入动作

当任务阻塞或高危时，页面应提供明确动作：

| 场景 | 动作 |
| --- | --- |
| 等待人工确认 | 主管确认并继续 |
| Agent 执行失败 | 重试当前步骤 |
| MCP 权限不足 | 跳转配置中心检查 MCP 白名单 |
| GitLab 分支缺失 | 跳转配置中心检查工程/分支映射 |
| 预算超限 | 调整 Skill 或提高预算后重新校验 |

## 7. 配置中心需求

### 7.1 配置中心入口

左侧「配置」入口应从「暂未开发」升级为可进入页面。

页面结构建议：

- Jira 配置。
- GitLab 配置。
- 代码检索配置。
- MCP 配置。
- Agent 执行配置。
- Skill 规则配置。
- 安全与审计配置。

### 7.2 Jira 配置

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| Jira Base URL | 是 | Jira 服务地址 |
| API 版本 | 是 | 例如 REST v2 |
| 认证方式 | 是 | PAT / Basic / OAuth / Cookie 代理 |
| 用户名 | 条件必填 | Basic 时需要 |
| Token/密钥 | 是 | 应脱敏展示 |
| 默认项目 | 是 | 例如 APMIS |
| 默认 JQL | 否 | 页面默认查询 |
| 保存筛选器 ID | 否 | 例如 86004 |
| 同步间隔 | 否 | 自动刷新频率 |
| 超时时间 | 是 | 请求超时 |

自定义字段映射：

| 页面字段 | Jira 字段 |
| --- | --- |
| 目标版本 | `cf[13301]` |
| 产品线和模块 | `cf[10126]` |
| 缺陷分类 | `cf[10302]` |
| 问题分类 | `cf[10116]` |
| 项目来源 | `cf[10121]` |
| 核心回收分析 | `cf[12400]` |
| 关联需求是否释放 | `cf[15603]` |

操作：

- 测试连接。
- 测试 JQL。
- 拉取字段元数据。
- 保存配置。
- 恢复默认配置。

### 7.3 GitLab 配置

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| GitLab Base URL | 是 | GitLab 服务地址 |
| Token | 是 | 用于读取项目、分支、MR |
| 默认 Group | 否 | 例如 apmis |
| 默认分支 | 是 | 例如 develop |
| MR 目标分支规则 | 否 | 按项目/模块配置 |
| MR 链接模板 | 否 | 用于生成跳转 |
| 代码检索最大文件数 | 是 | 防止超量扫描 |
| 历史 MR 检索范围 | 否 | 例如最近 180 天 |

工程映射规则：

| 规则 | 工程 | 分支 |
| --- | --- | --- |
| 标题或描述包含 Angular17 | `apmis/odcbs/odcbs-frontend` | `develop_to_angular17` |
| 前端代码 | `apmis/odcbs/odcbs-frontend` | `develop` |
| 后端代码 | `apmis/odcbs/odcbs-backend` | `develop` |
| 移动端代码 | `apmis/mobile/aims-mobile-vue` | `master` |
| PDA 代码 | `apmis/mobile/aims-pda-vue` | `main` |

操作：

- 测试连接。
- 搜索项目。
- 校验分支存在。
- 校验 MR 权限。
- 保存工程映射规则。

### 7.4 代码检索配置

字段：

- 默认检索深度。
- 最大文件数。
- 排除目录：`node_modules`、`dist`、`coverage`、`.git`。
- 支持文件类型：`.ts`、`.html`、`.scss`、`.css`、`.java`、`.xml` 等。
- 代码检索超时。
- 是否启用历史 MR 作为证据。
- 是否启用组件/路由/样式专项分析。

Angular17 专项建议：

- 检索 `angular.json`、`package.json`、路由定义、组件模板、样式文件。
- 优先检查图标、布局、动态表单、modal、table、route blank page。
- 输出相关文件路径、疑似原因、修复方案和验证命令。

### 7.5 MCP 配置

字段：

| 字段 | 说明 |
| --- | --- |
| MCP 名称 | JiraReader、GitLabReader、CodeRetrieval、GitLabMR 等 |
| Endpoint | MCP 服务地址 |
| 权限级别 | read / write / admin |
| 是否启用 | 开关 |
| 超时 | 单次调用超时 |
| 重试次数 | 失败重试 |
| 白名单项目 | 允许访问的项目 |
| 白名单仓库 | 允许访问的 GitLab 仓库 |
| 审计开关 | 是否记录 Trace |

操作：

- 测试 MCP 连接。
- 查看最近调用。
- 查看失败原因。
- 启用/停用 MCP。

### 7.6 Agent 执行配置

字段：

- 默认模型。
- 备用模型。
- 单任务预算。
- 单 Skill 超时。
- 最大并发任务数。
- 最大重试次数。
- 是否允许自动执行。
- 高危任务是否强制人工确认。
- 失败后策略：停止 / 重试 / 转人工。
- 心跳间隔。
- ETA 计算策略。

### 7.7 Skill 规则配置

需要支持把业务规则页面化，而不是写死在代码中。

字段：

| 字段 | 说明 |
| --- | --- |
| Skill 名称 | 例如 Angular17 升级回归分析 |
| 触发关键词 | Angular17、升级后、空白页、图标色差 |
| 适用项目 | APMIS |
| 推荐仓库 | `apmis/odcbs/odcbs-frontend` |
| 推荐分支 | `develop_to_angular17` |
| 推荐 Agent | Angular Expert |
| 默认 Skill 链路 | 需求澄清 → 影响面分析 → Angular17 分析 → 代码检索 → 方案生成 |
| 风险策略 | 是否需要人工确认 |
| 验证命令模板 | lint、test、build |

### 7.8 安全与审计配置

要求：

- Token 脱敏展示。
- Token 不在前端明文持久化。
- 修改配置需要审计。
- 写操作需要二次确认。
- 高危配置修改需要管理员权限。
- 所有测试连接记录结果和时间。

## 8. 关键用户故事

### US-01 查看 Agent 执行进度

作为研发主管，我希望 Jira 进入 Agent 执行中后能看到当前步骤、进度、预计完成时间和阻塞原因，以便判断是否需要介入。

验收标准：

- Pipeline 卡片显示进度和预计完成时间。
- 右侧执行步骤显示当前 running 步骤。
- 如果缺少心跳，显示「预计完成待计算」。
- 如果超时，显示超时提示。

### US-02 查看代码分析范围

作为开发负责人，我希望看到当前 Jira 代码分析使用的 GitLab 工程、分支、检索范围和命中证据，以便确认开发方案是否可信。

验收标准：

- Angular17 Jira 显示 `apmis/odcbs/odcbs-frontend@develop_to_angular17`。
- 证据链显示代码检索调用和命中文件。
- 开发方案显示修改点、风险、验证命令。

### US-03 配置 Jira 连接

作为平台管理员，我希望在配置中心配置 Jira 地址、认证、默认项目、JQL 和自定义字段映射，以便不同项目可以自助接入。

验收标准：

- 表单支持填写 Jira Base URL、认证和字段映射。
- 提供测试连接。
- 提供测试 JQL。
- 保存后页面使用新的配置。

### US-04 配置 GitLab 工程映射

作为平台管理员，我希望配置 Jira 到 GitLab 工程和分支的映射规则，以便代码分析能自动定位正确仓库。

验收标准：

- 支持配置关键词规则。
- 支持配置仓库和分支。
- 支持测试分支存在。
- Angular17 规则可页面化维护。

### US-05 配置 Agent 执行参数

作为平台管理员，我希望配置 Agent 并发、超时、预算、重试和人工确认规则，以便控制执行风险。

验收标准：

- 支持配置预算和超时。
- 支持配置最大并发。
- 支持配置失败策略。
- 高危任务可强制人工确认。

## 9. 状态矩阵

| 状态 | 页面表现 | 用户动作 |
| --- | --- | --- |
| 未触发 | 显示 Skill 已分配，无运行信息 | 校验并触发 |
| 排队中 | 显示排队位置和预计开始时间 | 可取消 |
| 运行中 | 显示当前 Agent、进度、ETA、日志 | 查看详情 |
| 等待人工确认 | 显示确认原因和确认按钮 | 主管确认并继续 |
| 阻塞 | 显示阻塞原因和建议动作 | 跳转配置或转人工 |
| 失败 | 显示失败步骤、错误、重试入口 | 重试 / 转人工 |
| 完成 | 显示完成时间、产物、证据链 | 查看 MR / 下载证据 |
| ETA 不可用 | 显示缺少心跳或预算 | 查看 Agent 配置 |

## 10. 信息架构调整

### 10.1 左侧导航

| 导航 | 目标状态 |
| --- | --- |
| Jira 调度 | 保持当前主页面 |
| Agent 状态 | 建议开发为独立 Agent 运行监控页 |
| Skill 管理 | 建议开发为 Skill 库和规则配置页 |
| 配置 | 建议开发为系统配置中心 |
| 知识库 | 后续承载经验资产和历史方案 |

### 10.2 右侧抽屉

「执行步骤」页签应升级为：

- Agent 执行总览。
- 步骤级进度。
- 执行日志。
- 产物与证据。
- 人工介入动作。

### 10.3 配置页面

建议采用 Tab 布局：

- Jira。
- GitLab。
- Code Retrieval。
- MCP。
- Agent。
- Skill Rules。
- Security & Audit。

## 11. 数据契约草案

```yaml
agent_run:
  run_id: string
  issue_key: string
  status: pending | queued | running | blocked | failed | waiting_human | completed
  current_skill: string
  current_agent: string
  started_at: iso_datetime
  updated_at: iso_datetime
  estimated_finish_at: iso_datetime | null
  elapsed_seconds: number
  remaining_seconds: number | null
  progress_percent: number
  heartbeat_at: iso_datetime | null
  block_reason: string | null
  steps:
    - step_id: string
      skill: string
      agent: string
      status: pending | running | ok | blocked | failed | waiting_human
      started_at: iso_datetime | null
      finished_at: iso_datetime | null
      estimated_seconds: number
      actual_seconds: number | null
      input_refs: string[]
      output_refs: string[]
      error: string | null
  logs:
    - time: iso_datetime
      source: agent | mcp | system | human
      level: info | warn | error
      message: string
      artifact_ref: string | null

config:
  jira:
    base_url: string
    api_version: string
    auth_type: pat | basic | oauth | proxy
    default_project: string
    saved_filter_id: string | null
    default_jql: string | null
    custom_fields:
      target_version: string
      product_module: string
      defect_category: string
      issue_category: string
      project_source: string
      core_recovery: string
      requirement_released: string
  gitlab:
    base_url: string
    default_group: string | null
    default_branch: string
    repo_rules:
      - name: string
        match_keywords: string[]
        repo: string
        branch: string
  mcp:
    servers:
      - name: string
        endpoint: string
        permission: read | write | admin
        enabled: boolean
        timeout_ms: number
        retry_count: number
  agent:
    default_model: string
    fallback_model: string | null
    max_concurrency: number
    skill_timeout_seconds: number
    task_budget_minutes: number
    retry_count: number
    heartbeat_interval_seconds: number
    require_human_for_high_risk: boolean
```

## 12. 优先级建议

### P0

- Agent 执行总览。
- Pipeline 卡片 ETA 和进度。
- 执行步骤状态细化。
- 配置中心 Jira/GitLab 基础配置。
- GitLab 工程/分支映射规则。

### P1

- 执行日志。
- 失败重试/转人工。
- MCP 白名单配置。
- Skill 规则配置。
- 连接测试。

### P2

- 独立 Agent 状态页。
- 通知告警。
- 知识库经验复用。
- 多环境配置。

## 13. 验收标准汇总

- 用户在 Jira 进入 Agent 执行后，能看到当前步骤、当前 Agent、进度、ETA、已耗时、剩余时间。
- 用户能判断任务是否阻塞、失败、超时或等待人工确认。
- 用户能查看 Agent 日志和产物。
- 用户能从配置中心配置 Jira 连接、字段映射、默认 JQL。
- 用户能从配置中心配置 GitLab 连接、工程映射、分支规则。
- Angular17 相关 Jira 能通过配置规则映射到 `apmis/odcbs/odcbs-frontend@develop_to_angular17`。
- 配置修改有状态提示和审计记录。
- 密钥类信息不在前端明文展示。

