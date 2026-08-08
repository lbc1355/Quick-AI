# Feature: chat

> 状态: `待审`

聊天对话：消息发送、流式生成、协调运行调度与会话忙互斥。

## 业务契约

| 项目 | 内容 |
|---|------|
| 触发 | 用户在输入框提交消息、重新生成、编辑消息后重发,或通过 / 指令/@ 技能触发发送 |
| 结果 | 成功:流式回复完整展示并写入会话;中止:用户取消/窗口失焦,已生成部分保留;失败:模型异常/API Key 缺失,提示错误且不产生半条消息 |
| 范围 | 消息发送与提示词组装, 协调运行调度(startCoordinatedRun), 会话忙互斥 |
| 不负责 | 模型服务商配置(→model-providers), 会话持久化细节(→session-management), 工具执行策略(→agent-run) |
| 关键约束 | 发送前必须确保所选服务商 API Key 已配置, 会话忙碌(isSessionBusy)时禁止重复提交 |
| 支撑链路 | send-message |


## 执行链路


### Flow: copy-message

复制消息文本到剪贴板（user 消息复制按钮）

1. D-Git-Quick-Ai.src.renderer.src.features.chat.useAgentMessageViewModel.handleCopy [✓] — 复制消息文本(finalReplyText)到剪贴板；经 MessageBubble→MessageActions(canCopy+onCopy) 触发，user 与 assistant 消息共用


### Flow: send-message

消息发送：渲染进程触发，经 IPC 到主进程协调运行并调用模型

1. D-Git-Quick-Ai.src.renderer.src.hooks.useChatCompletion.handleSendMessage [✓] — 渲染进程触发发送（经 IPC 到主进程，跨进程边界）
2. D-Git-Quick-Ai.src.main.ipc.generationIpc.startCoordinatedRun [✓] — 主进程协调运行入口（IPC 边界，经 start() 进入 SessionCoordinator）
3. D-Git-Quick-Ai.src.main.sessionCoordinator.SessionCoordinator.start [✓] — 会话协调：忙互斥与上下文纪元推进
4. D-Git-Quick-Ai.src.main.aiClient.handleChatCompletion [✓] — 聊天完成处理（经 execute 闭包接线）：内存注入与模型调用
5. D-Git-Quick-Ai.src.main.agent.callModel.callModel [✓] — 直接模型调用


## 跨功能引用(注意:此链路上符号也属于)

- `D-Git-Quick-Ai.src.main.agent.callModel.callModel` → agent-run, context-compaction
