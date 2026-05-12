# AI 开发中枢 · Jira 调度与 Skill 编排驾驶舱设计文档

版本：v0.1  
日期：2026-05-06  
适用范围：`apps/showcase` 前端 Showcase MVP 后续优化  
目标用户：研发主管、产品负责人、项目经理、AI 交付平台管理员

## 1. 产品定位

该页面不是普通 Jira 报表，也不是单纯的 AI 演示页，而是面向研发主管的「AI 开发中枢调度台」。

核心目标：

- 从真实 Jira 需求进入 AI 交付流程。
- 支持人工为 Jira 分配 Skill，或采纳系统推荐 Skill。
- 将任务送入 Agent 执行流水线，并持续追踪 MR、证据链、Trace 与人工确认点。
- 让主管在一个页面内回答三个问题：
  - 今天哪些 Jira 需要处理？
  - 哪些任务已经进入 AI 流水线，卡在哪一步？
  - 哪些高风险动作需要人工确认？

## 2. 设计原则

- 主视野优先：中央区域优先展示 Jira 队列和 Active Pipeline。
- 操作不抢视野：Skill 分配、证据链、步骤详情放入右侧抽屉。
- 先治理后执行：任何写 Jira、写 GitLab、创建 MR、改变状态的动作必须经过触发前校验。
- 可解释：每个推荐 Skill 都必须显示推荐原因、输入来源、Agent、MCP 权限和预计耗时。
- 低打扰 AI：策略思考助手默认收起，只作为右下角浮动入口。

## 3. 信息架构

页面采用「左导航 + 左筛选 + 中央主视野 + 右侧抽屉 + 底部审计 + 右下 AI」布局。

| 区域 | 名称 | 主要用途 | 默认状态 |
| --- | --- | --- | --- |
| A | 左侧全局导航 | 模块切换、用户身份、环境状态 | 常驻 |
| B | 顶部控制条 | 项目、版本、同步、自动执行控制 | 常驻 |
| C | KPI 摘要 | 当日调度状态总览 | 常驻 |
| D | Jira 筛选器 | 快速定位 Jira 队列 | 可折叠 |
| E | Jira Issue Queue | Jira 任务池与 Skill 分配入口 | 主视野 |
| F | Active Pipeline | AI 交付流水线状态 | 主视野 |
| G | 右侧详情抽屉 | Skill 编排、执行步骤、证据链、MR | 选中 Jira 后打开 |
| H | Execution History | 审计日志与历史产物 | 底部可折叠 |
| I | 策略思考助手 | 类 Notion AI 的问答入口 | 右下角收起 |

## 4. 页面区域设计

### 4.1 左侧全局导航

功能：

- 提供系统级模块切换。
- 保持当前页面定位。
- 展示当前用户身份。

菜单：

- 仪表盘
- Jira 调度
- 工作流
- Skill 管理
- Agent 状态
- 知识库
- 配置

交互：

| 控件 | 行为 |
| --- | --- |
| 菜单项 | 点击切换模块；当前页「Jira 调度」高亮 |
| 用户区 | 点击打开用户菜单，包含个人设置、环境切换、退出 |
| 小牛头像 | 仅作为品牌识别，不承载主操作 |

### 4.2 顶部控制条

内容：

- 标题：`AI 开发中枢 · Jira 调度与治理驾驶舱`
- 副标题：`Jira → Skill 编排 → Agent 执行 → MR Review → 人工确认`
- 实时连接状态
- 项目选择
- 目标版本选择
- 自动执行开关
- 最近同步时间
- 刷新
- 同步并触发

按钮交互：

| 控件 | 默认文案 | 交互 |
| --- | --- | --- |
| 实时连接 | 实时连接 | 绿色为在线，灰色为断开；悬停显示最近心跳时间 |
| 项目下拉 | APMIS | 切换项目后刷新 Jira 队列、KPI、Pipeline |
| 目标版本下拉 | 实时 Jira | 切换版本后重算 JQL 和统计 |
| 自动执行开关 | OFF | 开启前弹出确认；若开启，低风险任务可在保存编排后自动进入执行 |
| 刷新 | 刷新 | 只读拉取 Jira、Pipeline、Agent 状态 |
| 同步并触发 | 同步并触发 | 先同步，再对已保存且校验通过的编排触发执行 |

状态规则：

- 自动执行为 OFF 时，所有任务必须人工点击「校验并触发」。
- 自动执行为 ON 时，仅低风险、无写操作、校验通过任务可自动执行。
- 任一 MCP 不可用时，「同步并触发」降级为「仅同步」并显示原因。

### 4.3 KPI 摘要区

建议保留 5 张卡，不再展示过多指标。

| KPI | 含义 | 点击行为 |
| --- | --- | --- |
| 待处理 | 当前筛选范围内尚未进入流水线的 Jira 数 | 过滤 Jira 队列为待处理 |
| 运行中 | 正在由 Agent 执行的任务数 | 聚焦 Pipeline 的 Agent 执行中列 |
| 待人工确认 | 等待主管确认、Review、拍板的任务数 | 过滤 Pipeline 为等待人工确认 |
| 失败需介入 | 今日失败且需要人工处理的任务数 | 打开失败任务筛选 |
| 平均耗时 | 从触发到当前状态的平均耗时 | 打开耗时分布浮层 |

视觉规则：

- 失败需介入使用红色。
- 待人工确认使用橙色。
- 运行中使用蓝色。
- 完成/通过使用绿色。

### 4.4 Jira 筛选器

位置：左侧内容栏，可折叠。

字段：

- 项目
- 模块
- 类型
- 优先级
- Jira 状态
- 调度状态
- 负责人
- 标签
- 搜索框
- 保存的筛选器

交互：

| 控件 | 行为 |
| --- | --- |
| 收起 | 将筛选器折叠为窄栏，只保留筛选图标和当前命中数 |
| 搜索框 | 支持 Issue Key、Summary、模块、负责人模糊搜索 |
| 保存的筛选器 | 点击后套用条件，并更新 JQL 预览 |
| 重置 | 恢复当前项目/版本默认条件 |

保存筛选器建议：

- 我的待确认
- 高危待处理
- 未分配 Skill
- MR 待 Review
- 今日失败

### 4.5 Jira Issue Queue

定位：任务池，是 Skill 分配的入口。

列设计：

| 列 | 描述 |
| --- | --- |
| 选择框 | 支持批量分配 Skill 模板 |
| Issue Key | Jira 编号，可点击跳转 Jira |
| Summary | Jira 标题，最多两行 |
| 模块 | Jira component 或项目模块 |
| 优先级 | P0/P1/P2/中/低 |
| 负责人 | 当前 Jira assignee |
| 调度状态 | 未编排、待校验、已触发、执行中、等待人工、失败 |
| 已分配 Skill | 展示 Skill 数量或主要 Skill 标签 |
| 操作 | 分配 Skill、查看详情 |

行交互：

| 操作 | 行为 |
| --- | --- |
| 单击行 | 选中 Jira，打开右侧抽屉的「概览」页签 |
| 点击「分配 Skill」 | 打开右侧抽屉并切换到「Skill 编排」页签 |
| 勾选多行 | 顶部出现批量操作条 |
| 双击 Issue Key | 新窗口打开 Jira 原始页面 |

批量操作条：

- 批量套用模板
- 批量分配负责人
- 批量进入校验
- 取消选择

### 4.6 Active Pipeline

定位：页面核心主视野，用于呈现 AI 交付流转。

列：

- 待理解
- Skill 已分配
- Agent 执行中
- MR 待 Review
- 等待人工确认

任务卡字段：

- Issue Key
- Summary 简写
- 已绑定 Skill 标签
- 当前 Agent
- 当前状态
- 耗时
- 风险等级

交互：

| 操作 | 行为 |
| --- | --- |
| 点击任务卡 | 打开右侧抽屉对应详情 |
| 拖动卡片 | MVP 阶段禁用；后续可支持人工改状态 |
| 点击列标题 | 过滤中央队列为该状态 |
| 点击 `+N 张卡片` | 展开该列更多任务 |

特殊状态：

- Jira 已选中但未保存编排：在 Pipeline 中显示虚线预览卡「待保存编排」。
- 任务失败：卡片红色边框，点击直达失败步骤。
- 等待人工确认：卡片橙色边框，按钮显示「去确认」。

### 4.7 右侧详情抽屉

触发：

- 选中 Jira 行。
- 点击「分配 Skill」。
- 点击 Pipeline 任务卡。
- 点击审计日志中的「查看」。

宽度：

- 桌面端建议 420px - 480px。
- 小屏时改为全宽底部抽屉。

页签：

- 概览
- Skill 编排
- 执行步骤
- 证据链
- MR

#### 4.7.1 概览页签

展示：

- Jira Key / Summary
- Jira 状态、优先级、负责人
- 原始 Jira 描述摘要
- 推荐处理路径
- 当前调度状态

按钮：

| 按钮 | 行为 |
| --- | --- |
| 打开 Jira | 新窗口打开 Jira 链接 |
| 查看原文 | 展开完整 Jira 描述 |
| 分配 Skill | 切换到 Skill 编排页签 |

#### 4.7.2 Skill 编排页签

这是本次设计重点。

顶部推荐原因卡：

- 示例文案：`Jira 描述涉及器械追溯、表单字段联动、手术清点单字段带入，GitLab 影响面待解析。`

Skill 编排列表字段：

| 字段 | 描述 |
| --- | --- |
| 勾选 | 是否启用该 Skill |
| 排序 | 拖拽改变执行顺序 |
| Skill | Skill 名称 |
| 推荐 Agent | PM Agent、Impact Analyst、Code Searcher 等 |
| MCP 权限 | JiraReader、GitLabReader、CodeRetrieval 等 |
| 输入来源 | Jira 描述、评论、GitLab 仓库、MR Diff |
| 预计耗时 | 单步预计执行时间 |
| 风险门禁 | 无、需确认、写操作确认 |

Skill 候选：

- 需求澄清
- 影响面分析
- 代码检索
- 方案生成
- 测试用例生成
- MR Review
- 安全扫描

标签：

- 推荐
- 必选
- 可选
- 需人工确认

按钮：

| 按钮 | 行为 |
| --- | --- |
| 仅保存草稿 | 保存当前选择和顺序，不进入校验 |
| 保存编排 | 保存 Skill 编排，Pipeline 显示为 Skill 已分配 |
| 校验并触发 | 执行触发前校验；通过后进入 Agent 执行中 |
| 应用模板 | 打开模板选择浮层 |
| 重置推荐 | 恢复系统推荐 Skill 和顺序 |

触发前校验：

| 校验项 | 通过状态 | 不通过处理 |
| --- | --- | --- |
| Jira 只读权限 | 通过 | 禁止读取并提示重新配置 |
| GitLab 写入 | 需确认 | 弹出主管确认 |
| MCP 白名单 | 通过 | 标出不可用 Skill |
| 预算 | 未超限 | 禁用触发并提示拆分 |
| 高危写操作 | 需确认 | 必须二次确认 |

#### 4.7.3 执行步骤页签

展示：

- clarify
- impact_analyze
- code_retrieval
- plan_generate
- test_generate
- mr_review

每步字段：

- 状态：pending/running/ok/failed/blocked
- Agent
- 开始时间
- 耗时
- 输入
- 输出摘要
- Trace 链接

按钮：

| 按钮 | 行为 |
| --- | --- |
| 重试步骤 | 仅对 failed 步骤可用 |
| 跳过步骤 | 仅管理员可用，必须记录原因 |
| 查看 Trace | 打开对应 Trace 详情 |
| 终止任务 | 高危操作，二次确认 |

#### 4.7.4 证据链页签

展示：

- Evidence Pack
- Jira 原文
- Jira 评论
- GitLab 文件命中
- MR Diff
- MCP 调用日志
- 推理摘要

按钮：

| 按钮 | 行为 |
| --- | --- |
| 下载证据包 | 下载 Evidence Pack |
| 复制证据链接 | 复制当前证据地址 |
| 查看 MCP 调用 | 展开 MCP 调用明细 |

#### 4.7.5 MR 页签

展示：

- 关联 MR
- MR 状态
- 目标分支
- 变更文件
- Review 状态
- CI 状态

按钮：

| 按钮 | 行为 |
| --- | --- |
| 打开 MR | 新窗口打开 GitLab MR |
| 发起 Review | 进入 MR Review Skill |
| 标记需人工确认 | 将任务推入等待人工确认列 |

### 4.8 Execution History / 审计日志

位置：底部抽屉，默认展开约 150px。

列：

- Issue Key
- Skill
- Agent
- Workflow
- 耗时
- 状态
- 产物
- 操作

产物按钮：

- 证据包
- MR
- Trace

交互：

| 控件 | 行为 |
| --- | --- |
| 展开 | 底部抽屉展开到 50% 页面高度 |
| 收起 | 回到默认 150px |
| 查看 | 打开右侧抽屉并定位到对应步骤 |
| Trace | 打开 Trace 详情 |
| MR | 打开 GitLab MR |

### 4.9 策略思考助手

位置：右下角浮动入口。

默认：

- 仅显示小牛头像按钮。
- 气泡提示：`可问：这个 Jira 应该分配哪些 Skill？`

打开后：

- 弹出类 Notion AI 对话浮层。
- 不遮挡主视野核心区域，宽度约 420px。

推荐问题：

- 这个 Jira 应该分配哪些 Skill？
- 哪个任务需要主管先确认？
- 当前流水线瓶颈在哪里？
- 为什么这个 Skill 被推荐？

按钮：

| 按钮 | 行为 |
| --- | --- |
| 发送 | 提交问题，生成回答 |
| 最小化 | 收起浮层，保留入口 |
| 关闭 | 关闭浮层 |
| 引用当前 Jira | 将选中 Jira 作为上下文 |

## 5. 关键流程

### 5.1 单个 Jira 分配 Skill

1. 用户在 Jira Issue Queue 中点击 `APMIS-2122`。
2. 右侧抽屉打开，展示概览。
3. 用户点击「分配 Skill」。
4. 抽屉切换到「Skill 编排」。
5. 系统给出推荐 Skill 和推荐原因。
6. 用户勾选 Skill、调整顺序。
7. 用户点击「保存编排」或「校验并触发」。
8. 若触发前校验通过，任务进入 Active Pipeline。
9. 底部审计日志新增记录。

### 5.2 批量分配 Skill 模板

1. 用户勾选多个 Jira。
2. 出现批量操作条。
3. 用户点击「批量套用模板」。
4. 选择模板，如「需求分析标准链路」。
5. 系统预览影响范围。
6. 用户确认后保存为草稿，不默认触发。

### 5.3 高危写操作确认

1. 用户点击「校验并触发」。
2. 系统发现 GitLab 写入或 Jira 状态变更。
3. 弹出二次确认。
4. 用户确认后继续；取消则保存为待确认。
5. 审计日志记录确认人、时间、原因。

## 6. 状态矩阵

| 状态 | Jira 队列表现 | Pipeline 表现 | 可用操作 |
| --- | --- | --- | --- |
| 未编排 | Skill 显示未分配 | 不出现或显示预览 | 分配 Skill |
| 草稿 | Skill 显示草稿 | Skill 已分配列灰态 | 编辑、校验并触发 |
| 待校验 | 显示待校验 | Skill 已分配列 | 校验、编辑 |
| 执行中 | 显示执行中 | Agent 执行中列 | 查看步骤、终止 |
| 等待人工 | 显示需确认 | 等待人工确认列 | 确认、驳回 |
| 已完成 | 显示完成 | 可在历史中查看 | 查看产物 |
| 失败 | 红色失败 | 失败标记 | 重试、查看 Trace |

## 7. 异常与空状态

| 场景 | 展示 |
| --- | --- |
| Jira 未连接 | 顶部实时连接灰色，队列显示配置入口 |
| 无匹配 Jira | 队列显示空状态和重置筛选按钮 |
| Skill 推荐失败 | 抽屉显示手动选择 Skill，并提示缺少上下文 |
| MCP 不可用 | 禁用相关 Skill，显示不可用原因 |
| GitLab 未配置 | 代码检索、MR Review 标记为需配置 |
| 预算超限 | 禁用触发按钮，建议拆分任务 |

## 8. 权限与安全

- 只读用户：可查看 Jira、Pipeline、证据链，不可触发执行。
- 研发主管：可保存编排、触发低风险任务、确认高危任务。
- 管理员：可修改 Skill 模板、跳过步骤、终止任务。
- 所有写操作必须记录审计日志。
- Jira 描述中的账号、IP、密码、连接串必须脱敏展示。

## 9. 可访问性与前端约束

- 所有按钮必须有明确文本或 `aria-label`。
- 抽屉打开后焦点进入抽屉标题，Esc 可关闭。
- 右侧抽屉关闭后焦点回到触发按钮。
- 表格行选中状态必须有非颜色提示。
- 状态标签不得仅靠颜色区分，必须有文字。
- 移动端或窄屏下右侧抽屉改为底部全宽抽屉。

## 10. UI 实现契约

```yaml
surface: jira_dispatch_skill_assignment_cockpit
platform: desktop_web
primary_user: engineering_manager
core_goal: assign_skills_to_jira_and_track_ai_delivery_pipeline

layout:
  left_nav:
    type: fixed
    width: 80
    items:
      - 仪表盘
      - Jira 调度
      - 工作流
      - Skill 管理
      - Agent 状态
      - 知识库
      - 配置
  top_control_bar:
    controls:
      - realtime_status
      - project_select
      - target_version_select
      - auto_execute_toggle
      - last_sync_time
      - refresh_button
      - sync_and_trigger_button
  left_filter_panel:
    type: collapsible
    fields:
      - project
      - module
      - issue_type
      - priority
      - jira_status
      - dispatch_status
      - assignee
      - label
      - search
  center:
    primary:
      - jira_issue_queue
      - active_pipeline
  right_drawer:
    trigger:
      - select_jira
      - assign_skill
      - select_pipeline_card
      - select_audit_record
    tabs:
      - 概览
      - Skill 编排
      - 执行步骤
      - 证据链
      - MR
  bottom_drawer:
    type: collapsible
    content: execution_history
  floating_assistant:
    type: notion_style_popover
    default: collapsed

jira_issue_queue:
  columns:
    - selected
    - issue_key
    - summary
    - module
    - priority
    - assignee
    - dispatch_status
    - assigned_skills
    - actions
  actions:
    - assign_skill
    - view_detail
    - open_jira

skill_assignment:
  modes:
    - recommended
    - manual
    - template
  skill_candidates:
    - 需求澄清
    - 影响面分析
    - 代码检索
    - 方案生成
    - 测试用例生成
    - MR Review
    - 安全扫描
  fields:
    - enabled
    - order
    - skill
    - recommended_agent
    - mcp_permission
    - input_source
    - estimated_duration
    - risk_gate
  actions:
    - save_draft
    - save_orchestration
    - validate_and_trigger
    - apply_template
    - reset_recommendation

preflight_gates:
  - jira_read_permission
  - gitlab_write_confirmation
  - mcp_allowlist
  - budget_limit
  - high_risk_confirmation

pipeline:
  columns:
    - 待理解
    - Skill 已分配
    - Agent 执行中
    - MR 待 Review
    - 等待人工确认
  card_fields:
    - issue_key
    - summary
    - skills
    - agent
    - status
    - duration
    - risk

audit_history:
  columns:
    - issue_key
    - skill
    - agent
    - workflow
    - duration
    - status
    - artifacts
    - action
  artifacts:
    - evidence_pack
    - mr
    - trace
```

## 11. MVP 验收标准

- 可以从 Jira 队列选中一条任务并打开右侧抽屉。
- 可以在抽屉中为 Jira 勾选至少 3 个 Skill。
- 可以保存 Skill 编排，并在 Pipeline 中看到对应任务状态变化。
- 点击「校验并触发」时展示触发前校验结果。
- 高危写操作必须出现人工确认状态。
- Execution History 能看到最近一次保存或触发记录。
- 策略思考助手默认收起，打开后能引用当前 Jira 上下文。
