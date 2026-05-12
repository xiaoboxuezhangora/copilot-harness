# W8 Jira 到 GitLab 映射草稿

- 生成时间：2026-05-08T14:46:39.111Z
- Jira 查询来源：env:W8_MAPPING_JIRA_JQL
- Jira JQL 哈希：c9bf76a434c03a145efb48ebf12c2f92b8dc1cb4cddce455a1b32b30ec08efa2
- Jira 样本数：15 / 总数 15
- 已扫描 GitLab 成员工程数：160
- 已搜索 GitLab issue-key 历史的工单数：15
- 高置信工单候选数：12

## 更新协议

- 状态流转：候选(candidate) -> 已确认(confirmed) -> 已驳回(rejected) -> 已替代(superseded)
- 合并策略：可以反复重新生成候选规则，但不得覆盖人工标记为 confirmed/rejected 的规则；只有经过人工确认后，才能提升为 eval 真值数据。
- 确认策略：只有工程和分支都经过人工确认，或存在 GitLab issue-key 历史证据支撑时，规则才可标记为 confirmed。

## 人工确认规则库

| 规则 | GitLab 工程 | 分支策略 | 说明 |
| --- | --- | --- | --- |
| 标题或描述包含 Angular17 | apmis/odcbs/odcbs-frontend | 固定 develop_to_angular17 | Angular17 相关工单固定进入前端 Angular17 升级分支。 |
| 单点登录系统厂商对接 | apmis/dc-sso | 固定 master | dc-sso 用于对接各单点登录系统厂商。 |
| 电子签名厂商对接 | apmis/ca-sso/odcbs-ca | 固定 master | odcbs-ca 用于对接各个电子签名厂商；GitLab 已验证路径为 apmis/ca-sso/odcbs-ca。 |
| 移动端代码 | apmis/mobile/aims-mobile-vue | 主版本 master；西安交通大学 xajd；广东省人民 gdsrm | aims-mobile-vue 是移动端代码。 |
| PDA 代码 | apmis/mobile/aims-pda-vue | 主版本 main；广东省人民 gdsrm | aims-pda-vue 是 PDA 代码。 |
| 后端代码 | apmis/odcbs/odcbs-backend | 开发分支 develop；广东省人民 gdsrm_develop | odcbs-backend 是后端代码。 |
| 前端代码 | apmis/odcbs/odcbs-frontend | 开发分支 develop；广东省人民 gdsrm_develop；Angular17 由更高优先级规则进入 develop_to_angular17 | odcbs-frontend 是前端代码。 |
| 手麻平台三方交互接口 | apmis/odbip/odbip-custom-backend | 固定 develop | odbip-custom-backend 是当前手麻平台项目，用于处理手麻系统一切跟三方系统交互接口的处理；GitLab 验证实际分支为 develop，未发现 deveop。 |

## 候选字段规则

| 字段 | 字段值 | 工单数 | 推荐 GitLab 工程候选 | 示例 Jira 编号 |
| --- | --- | ---: | --- | --- |
| domain_rule | 新手麻代码在 APMIS | 15 | apmis/odcbs/odcbs-frontend（命中 15，平均置信度 0.878） | APMIS-1988, APMIS-2061, APMIS-2062, APMIS-2028, APMIS-2027, APMIS-2026, APMIS-2213, APMIS-2096, APMIS-2090, APMIS-2045 |
| jira_project | APMIS | 15 | apmis/odcbs/odcbs-frontend（命中 15，平均置信度 0.878） | APMIS-1988, APMIS-2061, APMIS-2062, APMIS-2028, APMIS-2027, APMIS-2026, APMIS-2213, APMIS-2096, APMIS-2090, APMIS-2045 |
| product_module | 手麻 | 15 | apmis/odcbs/odcbs-frontend（命中 15，平均置信度 0.878） | APMIS-1988, APMIS-2061, APMIS-2062, APMIS-2028, APMIS-2027, APMIS-2026, APMIS-2213, APMIS-2096, APMIS-2090, APMIS-2045 |
| project_source | Z总部集成测试 | 12 | apmis/odcbs/odcbs-frontend（命中 12，平均置信度 0.898） | APMIS-1988, APMIS-2061, APMIS-2062, APMIS-2028, APMIS-2027, APMIS-2026, APMIS-2213, APMIS-2096, APMIS-2045, APMIS-2088 |
| manual_rules | client.frontend.odcbs-frontend | 8 | apmis/odcbs/odcbs-frontend（命中 8，平均置信度 1） | APMIS-2028, APMIS-2027, APMIS-2213, APMIS-2090, APMIS-2045, APMIS-1955, APMIS-73, APMIS-1004 |
| manual_rules | text.angular17.frontend | 7 | apmis/odcbs/odcbs-frontend（命中 7，平均置信度 1） | APMIS-1988, APMIS-2061, APMIS-2062, APMIS-2028, APMIS-2027, APMIS-2026, APMIS-2213 |
| project_source | SH盛京医院 | 2 | apmis/odcbs/odcbs-frontend（命中 2，平均置信度 0.695） | APMIS-73, APMIS-840 |
| project_source | H怀化市第一人民医院 | 1 | apmis/odcbs/odcbs-frontend（命中 1，平均置信度 1） | APMIS-2090 |

## 高置信工单候选

| Jira 编号 | 候选 GitLab 工程 | 置信度 | 分支候选 | 证据 |
| --- | --- | ---: | --- | --- |
| APMIS-1988 | apmis/odcbs/odcbs-frontend | 1 | develop_to_angular17：人工确认规则 | 命中人工确认规则：标题或描述包含 Angular17 |
| APMIS-2061 | apmis/odcbs/odcbs-frontend | 1 | develop_to_angular17：人工确认规则 | 命中人工确认规则：标题或描述包含 Angular17 |
| APMIS-2062 | apmis/odcbs/odcbs-frontend | 1 | develop_to_angular17：人工确认规则 | 命中人工确认规则：标题或描述包含 Angular17 |
| APMIS-2028 | apmis/odcbs/odcbs-frontend | 1 | develop_to_angular17：人工确认规则 | 命中人工确认规则：标题或描述包含 Angular17 |
| APMIS-2027 | apmis/odcbs/odcbs-frontend | 1 | develop_to_angular17：人工确认规则 | 命中人工确认规则：标题或描述包含 Angular17 |
| APMIS-2026 | apmis/odcbs/odcbs-frontend | 1 | develop_to_angular17：人工确认规则 | 命中人工确认规则：标题或描述包含 Angular17 |
| APMIS-2213 | apmis/odcbs/odcbs-frontend | 1 | develop_to_angular17：人工确认规则 | 命中人工确认规则：标题或描述包含 Angular17 |
| APMIS-2090 | apmis/odcbs/odcbs-frontend | 1 | develop：人工确认规则 | 命中人工确认规则：前端代码 |
| APMIS-2045 | apmis/odcbs/odcbs-frontend | 1 | develop：人工确认规则 | 命中人工确认规则：前端代码 |
| APMIS-1955 | apmis/odcbs/odcbs-frontend | 1 | develop：人工确认规则 | 命中人工确认规则：前端代码 |
| APMIS-73 | apmis/odcbs/odcbs-frontend | 1 | develop：人工确认规则 | 命中人工确认规则：前端代码<br>gitlab:apmis/odcbs/odcbs-frontend#mr:1737<br>gitlab:apmis/odcbs/odcbs-frontend#mr:1717 |
| APMIS-1004 | apmis/odcbs/odcbs-frontend | 1 | develop：人工确认规则 | 命中人工确认规则：前端代码 |

## 待确认动作

- 优先确认或驳回工单数量较多的 field_value_rules。
- 每条 confirmed 规则都需要明确 GitLab 分支策略：默认分支、版本分支或功能分支。
- 从 confirmed 的 issue_mappings 中挑选至少 20 条作为 W8 真实联合 eval 种子样本。
- 不要把 candidate 规则直接复制为 W8 真值，必须先经过人工确认。

