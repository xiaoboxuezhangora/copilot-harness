# Angular17 Upgrade Regression Case Index

## Purpose

该索引用于给 `angular17-upgrade-regression-handler` 提供**高置信历史案例参考**。

使用原则：

- 只做参考，不替代当前 issue 的复现与证据。
- 优先看“模式、路径、修复层级”，不要机械复用旧补丁。
- 只收录基准线 `6487b9527ff67c8056a9cc40b01c87af2e8618c0` 之后的代表性修复。

---

## Case Selection Rules

- 优先非 merge commit。
- 提交主题能表达具体症状。
- 路径与升级回归模式关联强。
- 对共享层修复有指导意义。

---

## Pattern Index

| Pattern | Typical symptoms | Priority paths | Representative commits |
| --- | --- | --- | --- |
| `modal-adapter-regression` | 标题/footer 不显示、modal 内容异常、批量弹窗受影响 | `share/component/common-modal/**`、`*modal*.html` | `16d9a0f4ffdd680dc27d665768010563d260e480`、`e63e7ff62713cc13c6fd877b0f12de6b1d30c4c7`、`f8e9f03bcdcc338372eae442ae8fd61a11cd0fb0` |
| `render-empty` | 页面/窗口打开后区域空白、右侧为空、内容未挂载 | 页面模板、wrapper、初始化链路 | `35ef4aab579a9ede319d2b3a14ccbe79e27bac13`、`5e88f6e5f659129bc010e6c04e7778afeb432522`、`411bcd2822c139cad7e896f3d67f091de8682e17`、`d98012093d8eae4d4cf4c2f6268d298aff01227f` |
| `style-ui-drift` | 图标未居中、只读文字不清晰、绿点冗余、样式不规整 | 页面 html/less + 共享样式 | `891321c2e2a6775e1443730e1628651bd1e13562`、`3ad5e4059596f38b4f3f107067d6ac6efa5fbde4`、`5ef9207fbe4fb080ac51e0e3b1a60e17660e9e6c`、`dd07ce8ea7a4fec26e3e2271b9909046eb08e9e3` |
| `icon-svg-color-regression` / `nz-icon-twotone-regression` | 升级后 SVG 图标颜色、双色图标、时间轴/术间概览 icon 与云端基线不一致 | `src/styles.less`、`app.module.ts`、`business/component/room-overview/**`、`share/component/patient-timeline-modal/**` | `APMIS-1993` 会话案例 |
| `timeline-monitor-interaction-regression` | 右键功能缺失、关键时间点被遮罩、监控拖拽后气泡值异常 | `business/anesthesia/ops-common/**` | `8e29c1e54b8d685a5a31ecf677a9103cf63b27a5`、`68ed9517575aeabd75e744bb03e2c0f765bb32cd`、`1b1a682f41ea3dc10e482af1d8589130ffaf3a72`、`42902f2bd23192c57461abb758ee8b7265a30d5b` |
| `dynamic-form-layout-regression` | tab 高度异常、必填/数字 0 校验异常、business previewer 表现漂移 | `share/dynamic-form/**`、`business-previewer/**` | `a9feb751ad7d57d9797db9c08a3d1714da02a968`、`ade1a7ac973ee207d686dc5aa0a3ff910e7a6db8`、`a456aad240aa0a594439ba489b9ac8af06a9e8f2` |
| `scroll-sticky-table-regression` | 表头不能固定、滚动后冻结失效、列表串行 | 表格 html、容器滚动链路 | `d6bf4651bc424f28fe485a37db0b4d7c63d42b1f`、`8fd1655c13c6db7bdcc56b90f9829ff8771dcc79`、`a56a753a5ba2f565dd6d76f3510f21410bd293a5` |
| `drag-order-regression` | 药品/事件拖拽失效、排序异常、fabric 升级后行为变化 | 时间轴、drug state、fabric 相关路径 | `995258f8463b2150bad840f5d097acbc3de4c258`、`6db14350f38e84a79de221424817bdd1f9774f54`、`8ade6e97cc6c8774d5fb2e1e2c7fcd30ba515d7e` |

---

## Pattern Details

## 1. modal-adapter-regression

### Symptoms

- common-modal 无法识别 title/footer
- nz-modal 升级后调用方式与原包装层失配
- 大量弹窗同时出现显示问题

### High-risk paths

- `odcbs-all/src/app/share/component/common-modal/common-modal.component.ts`
- `odcbs-all/src/app/**/*modal*.html`
- `odcbs-all/src/app/layout/path/wrapper/wrapper.component.html`

### Representative commits

- `16d9a0f4ffdd680dc27d665768010563d260e480` — 替换所有 nz-modal，跨 204 文件批量适配
- `e63e7ff62713cc13c6fd877b0f12de6b1d30c4c7` — common-modal 无法识别 `nzModalTitle` / `nzModalFooter`
- `f8e9f03bcdcc338372eae442ae8fd61a11cd0fb0` — 恢复 nz-modal 样式

### Triage hint

- 先查共享 modal 包装层，不要先改单页面。
- 若问题波及多个弹窗，优先判断是共享 modal 适配层而不是业务模板。

---

## 2. render-empty

### Symptoms

- 页面打开后右侧为空
- 窗口内容空白
- 弹窗能打开但主体没渲染
- 点击按钮无反应或表现为“空内容”

### High-risk paths

- 页面 html/ts
- `wrapper.component.ts`
- `pacu-main.component.ts`
- 共享挂载层和条件渲染点

### Representative commits

- `35ef4aab579a9ede319d2b3a14ccbe79e27bac13` — 解决窗口显示为空
- `5e88f6e5f659129bc010e6c04e7778afeb432522` — 修复弹窗内容显示为空
- `411bcd2822c139cad7e896f3d67f091de8682e17` — 相似病历查看详情窗口为空
- `d98012093d8eae4d4cf4c2f6268d298aff01227f` — 弹窗打不开或者打开为空
- `a2f54058cec723c9e1fe5cb48478507ca11ba053` — 快速录入页面显示为空

### Triage hint

- 先检查挂载点、`*ngIf`、默认选中链路、wrapper 注入与 modal content。
- “空白”不等于“无数据”；先区分是数据未到、视图未挂载，还是 empty state 缺失。

---

## 3. style-ui-drift

### Symptoms

- 图标未居中
- 只读文字显示不清晰
- 冗余绿点、白框、文字对齐异常
- UI 不规整但功能可用

### Representative commits

- `891321c2e2a6775e1443730e1628651bd1e13562`
- `3ad5e4059596f38b4f3f107067d6ac6efa5fbde4`
- `5ef9207fbe4fb080ac51e0e3b1a60e17660e9e6c`
- `dd07ce8ea7a4fec26e3e2271b9909046eb08e9e3`

### Triage hint

- 先找共享样式与公共组件类名漂移，再决定是否做页面局部修正。

---

## 4. timeline-monitor-interaction-regression

### Symptoms

- 术中监控右键按钮不出现
- 关键时间节点被遮罩
- 拖拽后值展示异常
- 时间轴相关操作失效

### High-risk paths

- `odcbs-all/src/app/business/anesthesia/ops-common/**`

### Representative commits

- `8e29c1e54b8d685a5a31ecf677a9103cf63b27a5`
- `68ed9517575aeabd75e744bb03e2c0f765bb32cd`
- `1b1a682f41ea3dc10e482af1d8589130ffaf3a72`
- `42902f2bd23192c57461abb758ee8b7265a30d5b`

### Triage hint

- 优先检查共享组件事件绑定、overlay、图层遮罩和 drag/order 相关状态层。

---

## 4a. icon-svg-color-regression / nz-icon-twotone-regression

### Symptoms

- Angular 17 / ng-zorro 升级后图标颜色与旧环境不一致。
- `nz-icon` / SVG path 从彩色变黑、变灰、变深或双色层次丢失。
- 术间概览、时间轴、患者路径等页面的完成/未完成/已安排图标与云端基线不一致。
- 临时全局 CSS 注入后视觉变化大，或修复一个页面后破坏 twotone 图标。

### High-risk paths

- `odcbs-all/src/styles.less`
- `odcbs-all/src/app/app.module.ts`
- `odcbs-all/src/app/business/component/room-overview/**`
- `odcbs-all/src/app/share/component/patient-timeline-modal/**`
- 使用 `nzType` / `nzTheme` / `nzTwotoneColor` 的组件模板

### Representative case

- `APMIS-1993` — 术间概览 / 时间轴图标颜色与 `http://10.101.17.100` 云端基线不一致。

### Key findings from APMIS-1993

- 不要把图标颜色回归直接等同于 CSS 继承问题；先确认 Angular、ng-zorro、`@ant-design/icons-angular`、`@ant-design/colors` 的升级前后版本差异。
- `@ant-design/icons-angular@17` 的 two-tone 渲染会基于 `primaryColor` 自动生成 `secondaryColor`（通过 `@ant-design/colors.generate(primary)[0]`），因此 `nzTwotoneColor="green"/"red"` 可能与旧环境或 Ant Design 标准色不一致。
- 全局样式 `.anticon svg * { fill/stroke: currentColor !important }` 会破坏 twotone 多色 path，把图标压成单色。
- 全局样式 `.anticon { color: inherit !important }` 可能覆盖组件局部颜色，导致局部修复无效。
- 如果云端旧环境可访问，应先用 `chrome_devtools` MCP 抓取远端 screenshot、DOM、computed style、SVG path fill/stroke，再决定修复方式。
- 如果旧环境图标实际更接近 outline 细线图标，局部切换 `nzTheme="outline"` 并显式设定颜色，通常比继续调 twotone 副色更可控。

### Triage hint

1. 先记录版本矩阵：Angular、ng-zorro、`@ant-design/icons-angular`、`@ant-design/colors`。
2. 用 Context7 查询 ng-zorro / Ant Design Icons 文档，并用本地 `node_modules` 源码确认实际行为。
3. 用 `chrome_devtools` MCP 对云端基线抓截图与 DOM；如果用户授权测试账号，可在当前任务中使用。
4. 同路径抓本地 DOM，对比：`.anticon` color、`svg` fill/stroke、`path` fill/stroke attributes、computedFill/computedColor。
5. 修复顺序：
   - 先移除或收窄全局 SVG `!important` 强覆盖；
   - 单页面差异优先组件局部修复；
   - 用显式 hex 色值替代 `green/red` 等命名色；
   - 必要时使用 outline 或自定义 icon literal 贴合旧环境；
   - 避免为了单页问题扩大共享样式覆盖。

### Validation checklist

- 云端 baseline screenshot 与本地修复后 screenshot 已对比。
- DOM 证据显示本地目标图标 `computedColor` / `computedFill` 与修复意图一致。
- 已确认全局 `.anticon` / `svg *` 规则没有破坏其他 twotone 图标。
- 至少 spot check 一个仍依赖 twotone 的页面或组件，确认双色图标未被压成单色。

---

## 5. dynamic-form-layout-regression

### Symptoms

- tab 高度问题
- 表单必填交验异常
- business previewer 表现不一致

### High-risk paths

- `odcbs-all/src/app/share/dynamic-form/**`
- `odcbs-all/src/app/share/dynamic-form/business-previewer/**`

### Representative commits

- `a9feb751ad7d57d9797db9c08a3d1714da02a968`
- `ade1a7ac973ee207d686dc5aa0a3ff910e7a6db8`
- `a456aad240aa0a594439ba489b9ac8af06a9e8f2`

### Triage hint

- 遇到多页面表单偏移时，优先查共享 dynamic-form，而不是先修当前页面。

---

## 6. scroll-sticky-table-regression

### Symptoms

- 表头不能固定
- 向右滚动后表头未冻结
- sticky / scroll 区域串行

### Representative commits

- `d6bf4651bc424f28fe485a37db0b4d7c63d42b1f`
- `8fd1655c13c6db7bdcc56b90f9829ff8771dcc79`
- `a56a753a5ba2f565dd6d76f3510f21410bd293a5`

### Triage hint

- 优先看容器滚动链路与 sticky header 关系，而不是只改表格局部样式。

---

## 7. drag-order-regression

### Symptoms

- 同时间多条记录拖拽后消失或顺序错乱
- fabric 升级后拖拽行为异常

### Representative commits

- `995258f8463b2150bad840f5d097acbc3de4c258`
- `6db14350f38e84a79de221424817bdd1f9774f54`
- `8ade6e97cc6c8774d5fb2e1e2c7fcd30ba515d7e`

### Triage hint

- 先查共享状态层、拖拽指令和排序副作用，不要先补样式。
