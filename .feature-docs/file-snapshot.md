# Feature: file-snapshot

> 状态: `待审`

工作区文件快照：运行开始与副作用批次后捕获文件树，支持回滚。

## 业务契约

| 项目     | 内容                                                                           |
| -------- | ------------------------------------------------------------------------------ |
| 触发     | 运行开始捕获基线;副作用工具批次落定后增量 checkpoint                           |
| 结果     | 工作区文件树快照捕获完成,变更清单(file_changes)发出,支持回滚与两级恢复         |
| 范围     | 运行级文件快照, 副作用批次 checkpoint, 变更清单生成, 回滚支撑                  |
| 不负责   | 具体文件工具实现(→file-operations)                                             |
| 关键约束 | 快照需在副作用批次后立即捕获,避免丢失中间态, 快照失败需安全降级,不得阻塞主循环 |
| 支撑链路 | snapshot-workspace                                                             |

## 执行链路

### Flow: snapshot-workspace

工作区快照：运行开始捕获文件树

1. D-Git-Quick-Ai.src.main.agent.agentLoop.runAgentLoop [✓] — 运行开始与副作用批次后调用快照
2. D-Git-Quick-Ai.src.main.agent.agentFileSnapshot.beginAgentFileSnapshot [✓] — 开始文件快照：定位 Git 仓库并序列化操作
3. D-Git-Quick-Ai.src.main.agent.agentFileSnapshot.captureTreeUnlocked [✓] — 捕获文件树（锁内执行）

## 跨功能引用(注意:此链路上符号也属于)

- `D-Git-Quick-Ai.src.main.agent.agentLoop.runAgentLoop` → agent-run, reasoning, session-management
