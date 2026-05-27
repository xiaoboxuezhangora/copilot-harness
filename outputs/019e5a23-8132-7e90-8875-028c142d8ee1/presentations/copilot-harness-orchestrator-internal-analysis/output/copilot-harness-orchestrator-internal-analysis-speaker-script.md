# Copilot-Harness Orchestrator 内部分析讲稿

适用场景：技术评审 / 跨部门分享 / 内部课题答辩  
建议时长：25-30 分钟  
资料来源：Notion《Copilot-Harness 分享文档 · Orchestrator 深度拆解》、当前仓库 docs 与 orchestrator/src 实现

## 01. 开场：Orchestrator 是中控塔

今天不讲“模型到底多聪明”，我们讲一个更现实的问题：怎么让聪明的模型在企业流程里不乱跑。

可以把 Orchestrator 理解成中控塔。它不替飞机飞，也不替模型思考；它负责决定航道、许可、预算、证据和留痕。没有它，AI 可能很会干活，但每一步是谁让它干的、为什么能干、花了多少、证据在哪，就会变成一团雾。

这份 PPT 有三层：Notion 负责把故事讲得好懂，仓库代码负责让口径站得住，最后交付口径负责把“已落地”和“下一步”讲清楚。

## 02. 核心命题：模型管上限，Harness 管下限

模型像发动机，决定马力上限；Harness 像底盘、刹车和仪表盘，决定这辆车能不能稳定上路。

所以我们不是在重新造一个 Copilot，也不是用一堆 prompt 把模型哄聪明。真正目标是把“会写代码的 AI”升级成“可交付、可审计、可复盘的研发副手”。模型决定能力上限，Harness 决定交付下限，Orchestrator 则负责中间每一步过程可控。

## 03. 工程现实：已落地和未放行要分开讲

当前仓库已经有控制面骨架，不是只停留在概念图上。已落地的包括 SDK/CLI 双 Runtime、Budget/Policy/Validator gates、Jira + Memory + Retrieval + Skill 上下文、JSONL 审计、Auto-Memory 候选提取与 Review CLI、Fleet/Arena deterministic mock。

但生产写回仍然按下暂停键：真实 /fleet worktree fanout、真实 GitLab MR 创建和 push、Jira Writer、Runner 完整 live CI、Memory MCP 生产 cutover 都还没有放开。

这页的讲法要稳：我们不是“已经能全自动交付”，而是“控制面已经搭好，危险动作还在门禁后面”。可信度比热血更值钱。

## 04. 总架构：Orchestrator 发号施令，模块各司其职

任务从 Jira、IDE、Bot 或计划任务进来后，Orchestrator 不亲自把所有活干完，而是调度专业模块。

context 先把证据和上下文装好；runtime 负责 SDK/CLI 执行壳；gates 负责预算、权限和验证；memory 负责经过审批的组织知识；audit 负责把成功失败都记下来。

类比饭店：客人点的是菜，但系统要管菜单、后厨顺序、禁忌、预算和小票。Orchestrator 就是把这一套串起来的前台加调度。

## 05. 五目录骨架：一条装配线，不是五个小老板

五个目录不要理解成五个小 Orchestrator。它们是被调度的专业岗位。

runtime 是发动机舱，隔离 SDK/CLI 差异；gates 是门禁岗，预算、权限、质量先过闸；context 是备菜台，把 Jira、代码、记忆和 Skill 装进结构化上下文；memory 是批改本，候选知识先 pending 再人工 review；audit 是黑匣子，成功失败都留下复盘依据。

关键原则是“调度 - 被调用”。如果这些模块互相串门，最后系统会变成谁都能审批、谁都能写库、谁也说不清责任。

## 06. 任务时序：先装保险，再上路

一次任务不是模型直接开跑，而是四步。

第一步 context.assemble，把 EvidencePack、hot_index、retrieval、skill hints 装好；第二步 runtime.run，选择 SDK/CLI adapter，带上 hooks 和固定模型；第三步 onToolCall，每次工具调用前经过 BudgetGate 和 PolicyGate；第四步 onTurnEnd，结果再经过 Validator、Auto-Memory 和 AuditLogger。

这里最精妙的是 Hook 反转控制。runtime 不必认识 gates，gates 也不必绑死 runtime。Orchestrator 只负责把插头插对，后面每个部件在自己的边界里工作。

## 07. 工具调用：模型点菜，Orchestrator 管菜单

现代 function calling 里，模型确实会在输出里写 tool_calls，决定这一步要调哪个工具、传什么参数。

但企业级系统的关键不在于“模型能不能选”，而在于“它能选的菜单是谁摆的”。Orchestrator 先决定允许哪些 tools 和 skills 出现在菜单上；模型只能从菜单里点；真正执行前还要过 BudgetGate 和 PolicyGate。

一句话：模型有选择权，Orchestrator 有否决权。这不是束缚模型，而是给模型装方向盘和刹车。

## 08. 路由漏斗：能用规则解决的，别让模型装神秘

路由不应该一上来就交给模型猜。更稳的方式是三层漏斗。

第一层规则路由：关键词、issue_type、字段、历史映射，这类最便宜也最可审计。第二层 Profile Spec：业务域固定打法和 Skill 配方，把组织经验沉淀下来。第三层才是模型软路由：小预算兜底，输出再经 PolicyGate 复核。

当前代码里已经能看到规则型 profile router，也能看到 skillAgentLoader 按业务语义追加 Skill 的例子。Notion 文档里的三层漏斗，适合作为后续路由治理蓝图。

## 09. 四道闸门：四个不近人情的同事

BudgetGate 像账房，问钱够不够；PolicyGate 像保安，问你准不准进；Validator 像质检，问结果合不合格；AuditLogger 像黑匣子，问小票有没有留下。

在医疗和企业高敏场景里，AI 不能只靠“这次表现挺好”。四道闸门的价值是：失败也要有结构，拦截也要有证据，复盘不能靠拍脑袋。

这就是从“能运行”到“可控运行”的分水岭。

## 10. BudgetGate：整趟旅程的油表

BudgetGate 不是只看单次请求贵不贵，而是看整项任务的累计水位：fanout、toolCalls、inputTokens、outputTokens、premiumRequests。

这就像报销单，不是“这杯奶茶贵不贵”，而是“今天这张单还能不能签”。如果超限，系统不会直接炸成 500，而是返回 blocked partial-result：已完成什么、为什么被拦、审计 trace 是什么、上游怎么恢复。

这类 partial-result 对企业流程很重要，因为上游可以转人工、降级重跑或保留半成品，而不是面对一个没有上下文的异常。

## 11. Auto-Memory：小纸条要先批改

Memory 最容易被误解成“AI 自动记笔记”。我们的设计更谨慎：AI 可以递小纸条，但不能自己把小纸条贴成公司制度。

Harvester 只处理 turn_state=done 且有 source_ref 的结果；提取出的候选还要经过 confidence、novelty、redline 等 gate；候选先进入 pending；Review CLI 里人工可以 accept、reject、edit；最后才写入 MemoryStore，并在下一轮以 hot_index 方式注入上下文。

类比错题本：系统可以自动整理错题，但不能自动替老师盖章。

## 12. Fleet / Arena：先模拟赛，再真上场

多 Agent 不是一拥而上。当前 FleetCoordinator 是 deterministic mock control-plane。

流程像选秀：planner 拆步骤，多个 implementer 交匿名 diff，Arena critic 按 correctness、test coverage、diff minimality、style 等维度评分，reviewer 只产出 draft artifact。

当前状态必须讲清楚：worktreeMode=mock，realFanout=real_disabled，realMergeRequest=real_disabled。也就是说，裁判和赛制已经练起来了，但真实选手上场还没开闸。

## 13. 市场姿态：借标准，补治理

不要把故事讲成“我们发明了 Orchestrator”。更准确的说法是：底层标准和共识模式尽量借，企业治理层自己补。

很多 Agent 框架解决的是怎么跑、怎么编排、怎么多 Agent 协作；Copilot-Harness 更关心企业里最缺的那层：预算、权限、证据、审计、人工 review。

一句话：底层能力尽量借标准，企业护栏必须自己做厚。因为出了事，框架不会来帮你写复盘。

## 14. 收束：下一步不是更大胆，而是更可验收

后续节奏不应该是“更大胆开权限”，而是“更可验收地开权限”。

建议顺序是：先刷新 showcase snapshot 和 W8 final PASS release gate；再接通 Runner，完成 W11 live CI 三闸；然后做 Memory 真实 dual-write drift 证据；再只读实现 Resolver；最后才考虑 Draft MR 写回，而且写回必须在 Policy Gate 后面。

最后可以用这句话收尾：我们不在 Agent 能力上重复造轮子，我们在 Agent 治理上独立造护栏。不是给模型戴手铐，是给模型装方向盘、刹车和行车记录仪。
