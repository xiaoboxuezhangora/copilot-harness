# 东软小牛 IP 插画资产

这一目录收敛当前 Showcase 可用的小牛插画资产，用于研发治理驾驶舱中的策略助手、任务复核、运行时、Memory、闸门和观测类场景。

## 资产标准

- 画布：`512x512`
- 格式：`PNG`
- 背景：统一浅蓝底 `#EDF6FF`
- 命名：`cow-{scene}-{role}.png`
- 元数据：见 `manifest.json`

## 推荐使用

- 策略思考助手：`cow-chief-presenter.png`
- Jira 任务拍板：`cow-clipboard-reviewer.png`
- AgentRuntime 说明：`cow-runtime-presenter.png`
- Memory 汇总：`cow-memory-reader.png`
- 高危策略确认：`cow-policy-inspector.png`
- 四道闸门说明：`cow-hook-guide.png`

## 质量边界

当前资产来自示例演示图裁切，优先解决“形象统一、可被前端稳定引用”的问题。由于源图不是透明角色稿，部分资产仍保留演示图的浅色底纹或局部 UI 边缘。后续若提供官方透明 PNG、PSD 或矢量稿，保持同名文件替换即可，不需要改前端引用。
