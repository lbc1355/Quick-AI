# Feature: reasoning

> 状态: `待审`

推理控制：每次运行的推理偏好解析与按模型能力适配。

## 业务契约

| 项目     | 内容                                                                                          |
| -------- | --------------------------------------------------------------------------------------------- |
| 触发     | 每次 Agent 运行启动时解析推理偏好(含 resume 继承与模型能力适配)                               |
| 结果     | 解析并适配出模型可用的推理偏好,写入运行生命周期供模型请求编码使用                             |
| 范围     | 运行级推理偏好解析, resume 继承, 按模型能力适配(fitReasoningPreference), 偏好归一化           |
| 不负责   | UI 推理选择器(→renderer ReasoningLevelSelector), 模型请求的具体编码(→agent-run model request) |
| 关键约束 | 偏好必须归一化为合法取值, 适配必须受模型能力约束,不支持推理的模型强制 auto                    |
| 支撑链路 | resolve-reasoning-preference                                                                  |

## 执行链路

### Flow: resolve-reasoning-preference

推理偏好解析：每次运行解析并适配推理偏好

1. D-Git-Quick-Ai.src.main.agent.agentLoop.runAgentLoop [✓] — 每次运行启动时解析推理偏好（含 resume 继承）
2. D-Git-Quick-Ai.src.main.agent.reasoningRunResolution.resolveRunReasoningPreference [✓] — 解析运行级推理偏好：run/会话/模型能力优先级
3. D-Git-Quick-Ai.src.shared.reasoningControl.fitReasoningPreference [✓] — 按模型能力适配推理偏好
4. D-Git-Quick-Ai.src.shared.reasoningControl.normalizeReasoningPreference [✓] — 归一化推理偏好为合法取值

## 跨功能引用(注意:此链路上符号也属于)

- `D-Git-Quick-Ai.src.main.agent.agentLoop.runAgentLoop` → agent-run, file-snapshot, session-management
