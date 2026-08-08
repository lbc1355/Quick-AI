# Feature: agent-run

> 状态: `待审`

Agent 智能体执行引擎：ReAct 主循环、运行前准备、模型回合与工具回合的编排与生命周期。

## 业务契约

| 项目 | 内容 |
|---|------|
| 触发 | 一次协调运行被启动(startCoordinatedRun)；模型回复中出现工具调用(tool_calls) |
| 结果 | 完成:模型产出最终回复,checkpoint 与事件流落盘;中止:loopGuard/用户中止/超时,checkpoint 可恢复;失败:模型连续失败触发重试耗尽 |
| 范围 | ReAct 主循环编排, 运行前准备(prepareAgentRun), 模型回合与工具回合执行, 工具调用规划与权限校验, 运行 checkpoint 与事件流 |
| 不负责 | 具体工具的内部实现(→file-operations 等), 会话 UI(→chat) |
| 关键约束 | 每次运行受 loopGuard 限制,禁止无限循环, 工具执行前必须经过权限校验(allow/ask/deny)与命令安全评级, 每步执行后必须更新 checkpoint,保证中断可恢复且不重放有副作用的成功工具 |
| 支撑链路 | agent-loop, model-turn, tool-turn |


## 执行链路


### Flow: agent-loop

ReAct 主循环：准备、模型回合、工具回合、强制收尾的逐 step 编排

1. D-Git-Quick-Ai.src.main.agent.agentLoop.runAgentLoop [✓] — ReAct 主循环入口：上下文裁剪、模型回合、工具回合逐 step 编排
2. D-Git-Quick-Ai.src.main.agent.agentRunPreparation.prepareAgentRun [✓] — 运行前准备：加载 resume 检查点/构建消息/确定工具发现模式


### Flow: model-turn

模型回合：调用模型并解析传输层

1. D-Git-Quick-Ai.src.main.agent.modelTurnRunner.runModelTurn [✓] — 模型回合编排：流式回调与缓存统计
2. D-Git-Quick-Ai.src.main.agent.callModel.callModel [✓] — 调用模型：解析传输 ID 并选择适配器（经 DI 默认接线）
3. D-Git-Quick-Ai.src.main.agent.modelTransport.getModelTransport [✓] — 获取传输层实现


### Flow: tool-turn

工具回合：调用规划、权限审批、批量执行与收尾

1. D-Git-Quick-Ai.src.main.agent.toolTurnRunner.runToolTurn [✓] — 工具回合编排：ask/direct/blocked 划分
2. D-Git-Quick-Ai.src.main.agent.toolStepProcessor.processPreparedToolStep [✓] — 处理已规划的工具调用：权限询问与事件分发
3. D-Git-Quick-Ai.src.main.agent.toolBatchRunner.runPreparedToolBatch [✓] — 批量执行工具调用（含重试与循环守卫）


## 跨功能引用(注意:此链路上符号也属于)

- `D-Git-Quick-Ai.src.main.agent.agentLoop.runAgentLoop` → file-snapshot, reasoning, session-management
- `D-Git-Quick-Ai.src.main.agent.callModel.callModel` → chat
- `D-Git-Quick-Ai.src.main.agent.toolBatchRunner.runPreparedToolBatch` → file-operations
- `D-Git-Quick-Ai.src.main.agent.toolStepProcessor.processPreparedToolStep` → file-operations
- `D-Git-Quick-Ai.src.main.agent.toolTurnRunner.runToolTurn` → file-operations
