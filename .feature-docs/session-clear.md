# Feature: session-clear

> 状态: `待审`

会话清除与撤销：/clear 暂存会话快照可撤回，下一条提示词提交时才真正清理资源缓存。

## 业务契约

| 项目 | 内容 |
|---|------|
| 触发 | 用户执行 /clear 指令或点击清空历史按钮 |
| 结果 | 成功:会话消息/标题/资源被清空且可撤销;撤销:还原 pre-clear 会话;提交:下一条提示词丢弃 undo 快照并清理孤儿资源缓存 |
| 范围 | 会话清除暂存(clearedDraft), 撤销清除(handleUndoClear), 延迟的资源缓存清理(commit 时), 被取代暂存态的即时清理 |
| 不负责 | 会话分支/恢复(→session-management), 会话消息渲染(→chat) |
| 关键约束 | 清除可撤销直到下一条提示词提交(与 revert 一致), 撤销必须完整还原消息/标题/资源, 资源缓存清理延迟到提交时,按孤儿资源计算, 不得误删其他会话仍引用的共享缓存 |
| 支撑链路 | clear-conversation, undo-clear, commit-clear |


## 执行链路


### Flow: clear-conversation

/clear 清除当前会话：暂存快照并清理被取代的旧暂存缓存

1. D-Git-Quick-Ai.src.renderer.src.hooks.useSessions.handleClearCurrentSession [✓] — /clear 入口：暂存 pre-clear 会话到 clearedDraft，清空消息/标题/资源，并清理被取代的旧 revert/旧 draft 缓存
2. D-Git-Quick-Ai.src.renderer.src.hooks.useSessions.clearCachesFor [✓] — 清理被取代暂存态的孤儿资源缓存（本次清除自身的资源保留以便撤销）


### Flow: commit-clear

提交清除：新提示词丢弃 undo 快照并触发延迟的缓存清理

1. D-Git-Quick-Ai.src.renderer.src.hooks.useChatCompletion.commitStagedRevert [✓] — 新提示词提交暂存：丢弃 undo 快照并触发缓存清理
2. D-Git-Quick-Ai.src.renderer.src.features.chat.sessionSnapshot.planStagedRevertCommit [✓] — 规划暂存提交：计算可删除的孤儿资源
3. D-Git-Quick-Ai.src.renderer.src.features.chat.sessionRevertService.commitSessionClearDraft [✓] — 丢弃 clearedDraft 并暴露其资源供缓存清理


### Flow: undo-clear

撤销清除：从暂存快照还原会话

1. D-Git-Quick-Ai.src.renderer.src.hooks.useSessions.handleUndoClear [✓] — 撤销清除：从 clearedDraft 还原消息/标题/资源
