# Copilot-Harness 内部分析分享讲稿

建议时长：18-25 分钟  
讲述风格：先讲人话，再讲系统；先打比方，再落到工程实现。  
核心主线：Harness 不是更长的 Prompt，而是把 AI 从“会回答”变成“能稳定交付”的系统外壳。

## 01 从 Harness 到 Copilot-Harness

各位先别急着问“AI 会不会写代码”。这个问题像问一台发动机“你马力大不大”。马力当然重要，但发动机放在桌上是不能上路的。

真正能上路，需要底盘、方向盘、刹车、仪表盘，还要有行车记录仪。今天要讲的 Harness，就是给 AI 装这些东西。模型能力像发动机，Harness 把执行环境、工具、证据、门禁、审计串成系统，最后变成稳定交付。

所以这次分享的重点不是“模型又聪明了多少”，而是“我们如何让模型的聪明被组织稳定复用”。Copilot-Harness 就是在 Copilot 能力之外补这套企业级外骨骼。

过渡：先把 Harness 讲清楚，再看 Copilot-Harness 才不会像看一堆模块名。

## 02 Harness 到底是什么？

Harness 不是把 Prompt 写得更长，也不是给模型套一层 UI。它更像一套整车系统。

没有 Harness 的时候，我们像把发动机摆桌上：单次回答可能很惊艳，但工具调用靠临场发挥，证据链时断时续，今天做出来的经验明天还要从头再来。

有 Harness 后，模型进入一个可控流程：Runtime 管执行环境，Tools 管工具菜单，Evidence 管证据袋，Gates 管门禁，Memory 管错题本，Audit 管小票。

换个更接地气的比喻：模型会炒菜，但 Harness 管菜谱、食材、厨房权限、出餐质检和小票。你不能因为厨师刀工好，就让他随便进冷库、随便刷老板的卡、出餐还不留记录。

过渡：明白了 Harness 是“整车系统”，再看 Copilot-Harness 的定位。

## 03 Copilot-Harness 是什么？

Copilot-Harness 不重造 Copilot。它更像是在官方 Copilot 能力外面，加一层企业控制面、认知面和治理面。

第一层是执行壳：Runtime、Tools、Agent Loop，目标是让任务稳定跑起来。上层不需要关心底层今天是 SDK 还是 CLI，能不能 resume、能不能 spawn，都要结构化暴露。

第二层是认知脑：Skill、Memory、MCP、Eval，目标是把一次交付里的隐性经验变成下一次可复用的资产。

第三层是安全网：Budget、Policy、Validator、Audit。它不负责让 AI 更聪明，它负责让 AI 聪明得有边界、有证据、有复盘。

过渡：这套认知资产不能混成一锅粥，必须先分层。

## 04 可复用经验资产要分层

经验资产不是“历史资料越多越好”。如果不分层，知识库很快就会变成 AI 版杂物间：什么都有，但谁也不敢直接用。

这里分四层：

Skill 是方法论，像打法手册，告诉 AI 遇到某类任务该怎么拆、怎么查、怎么验证。

Memory 是已验证事实，像组织的错题本和知识卡片。只有经过验证和审批的事实才应该进入这里。

MCP 是受控取证能力，像带门禁的资料室。它负责查 Jira、查代码、查日志，但每次取证都要有边界。

Eval 是回归验证，像考试卷。沉淀的经验到底有没有变好，不能靠感觉，要靠样本、预期和判定规则。

过渡：分层之后，经验才有机会进入闭环。

## 05 可复用经验落地闭环

这页是 Copilot-Harness 的闭环路线。看起来像流程图，讲起来其实像一次标准办案。

第一步，Jira 需求进来，先明确目标和范围。第二步，通过 MCP 去权威系统取证。第三步，把证据整理成 Evidence Pack，像把材料装进证据袋。第四步，按 Skill 选择合适的执行打法。第五步，Agent 输出结果。

到这里还没结束。第六步必须有人 Review，尤其是关键判断、风险边界、业务口径。第七步形成 Correction 候选，哪些地方可改、哪些经验可沉淀。第八步写入 Memory。第九步跑 Eval 回归，确认质量稳定。

这个闭环的关键是：每一次交付都不是故事结尾，而是下一次交付的预制菜。做得越多，下一次越不需要从冷锅冷灶开始。

过渡：闭环要跑起来，中间需要一个调度中枢。

## 06 Orchestrator：AI 研发中枢的空中交通管制

Orchestrator 最好不要理解成“另一个更聪明的 AI”。它更像空中交通管制塔台。

飞机自己会飞，飞行员自己会开，但塔台负责航道、许可、防撞和备降。Orchestrator 也是这样：它不替模型思考，不替工具干活，它负责决定任务走哪条链路、菜单里有哪些工具、状态怎么延续、失败后是重试、降级还是转人工。

所以 Orchestrator 的价值不是“我比模型更聪明”，而是“我让多个模型、工具、状态、门禁在一个可控秩序里协作”。

过渡：塔台下面第一件事，是要有稳定的执行壳。

## 07 Runtime 是执行壳

Runtime 可以理解成发动机舱加变速箱。上层只看方向盘和仪表盘，不应该每次底层 SDK、CLI 变一下，上层业务就跟着晕车。

所以工程里抽出 AgentRuntime 统一接口。SDK Runtime 和 CLI Runtime 的差异被隔离在下面，Hooks、Capability Flags 则告诉上层：我能不能做、支持到什么程度、不能做时如何结构化返回。

这里有个很重要的工程态度：不要假装支持。不能 spawn 就明确 blocked，不能 resume 就明确 unsupported。企业系统里，“假装能跑”比“明确不能跑”危险得多。

过渡：能跑只是第一步，跑之前还要备菜和装证据袋。

## 08 Context 与 EvidencePack：先备菜，再开火

AI 做任务前，不能只塞一句“你是资深工程师”。这就像让厨师开火前只说一句“你很会做饭”，但不给菜、不给锅、不给菜单。

Context 是备菜台：Jira 需求、代码片段、Memory hot_index、Skill hint 都要提前整理好。EvidencePack 是证据袋：task_id、intent、evidences、source_ref、assumptions 都要结构化。

这里最重要的原则是：没有 source_ref 的“灵感”，不能混进事实区。它可以放到 assumptions，可以标 confidence，但不能伪装成“已验证结论”。

换句话说，模型可以有想法，但组织记忆必须有出处。

过渡：有了上下文，接下来模型就会开始调用工具。

## 09 Tool Calling：模型点菜，Orchestrator 管菜单

工具调用可以用餐厅比喻。Orchestrator 先摆菜单：今天允许点哪些菜，哪些菜已经售罄，哪些菜需要经理审批。

模型负责点菜，也就是输出 tool_calls 和参数。然后 BudgetGate 看钱包，PolicyGate 看禁忌，最后工具才真的进厨房执行。

这套机制的金句是：模型有选择权，Orchestrator 有否决权。

这不是限制模型智商，而是防止模型聪明地闯红灯。企业场景里，越聪明的自动化，越需要清晰边界。

过渡：否决权具体落在哪里？落在四道闸门。

## 10 四道闸门：把“能运行”变成“可控运行”

四道闸门分别是 BudgetGate、PolicyGate、Validator、AuditLogger。

BudgetGate 像财务，负责看 token、toolCalls、fanout，防止任务在循环里烧钱。

PolicyGate 像门卫，负责只读白名单、高风险升级，尤其是写操作不能直接放行。

Validator 像质检，负责检查 turn_state、EvidencePack、source_ref 是否成立。没有证据的结果，不应该轻松过关。

AuditLogger 像黑匣子，成功失败都留痕。企业里出了问题最怕一句“我也不知道刚才 AI 怎么想的”。有审计，失败也有结构，复盘不靠猜。

过渡：闸门保证安全，但组织能力增长还要靠飞轮。

## 11 经验复利飞轮

Prompt 解决一次问题，Harness 想解决一类问题。这就是经验复利飞轮。

一次任务执行后，人工修正会指出问题；Harvester 抽取候选经验；Skill 和 Memory 更新；Eval 再验证质量；下一次任务就更准。

这里要特别强调：Memory 不是 AI 自动写祖训。更好的比喻是错题本。错题可以自动整理，但必须人工批改后才能进教材。

这也是 source_ref、版本、审批、回归四个护栏的意义。否则 Memory 很容易从“组织资产”变成“模型自信写下来的小作文”。

过渡：最后回到当前工程，哪些已经落地，哪些还在门禁后。

## 12 当前落地：控制面已成型，写回仍在门禁后

当前工程里已经可以讲的，是控制面骨架：SDK/CLI Runtime 统一接口，Budget/Policy/Validator Gate，Jira、Memory、Retrieval、Skill 上下文，Audit JSONL，Auto-Memory 和 Review CLI，以及 deterministic mock。

但有几件事还不能讲成“已经生产可用”：真实 fleet worktree fanout、真实 GitLab MR 写回、Jira Writer 自动流转、真实 Runner CI、Memory MCP 生产 cutover。这些都应该继续放在门禁后。

所以路线不是更大胆，而是更可验收：先接 Runner，把 CI 三闸跑稳；再做 Memory cutover，有 dual-write 证据；再做只读 Resolver，缺证据就转人工；最后才考虑 Draft MR 写回，并且写回必须在 Policy 后。

收尾一句：我们不在 Agent 能力上重复造轮子，我们在 Agent 治理上独立造护栏。真正的价值，是让一次次交付变成组织越来越会交付。

