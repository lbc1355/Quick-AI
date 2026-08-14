# Feature: session-management

> 状态: `待审`

会话/运行生命周期：运行上下文创建、中断恢复合并事件日志、分支派生复制执行状态。

## 业务契约

| 项目     | 内容                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 触发     | 新建会话、启动一次运行(create-run)、应用启动恢复被中断的运行、用户在历史消息上分支/重生成                                                             |
| 结果     | 创建:run 上下文与 manifest 建立,checkpoint 首次落盘;恢复:从 checkpoint 载入进度、合并事件日志后继续执行;分支:克隆会话的 checkpoint 与事件日志复制完成 |
| 范围     | AgentRunContext 生命周期, runManifest 记录, checkpoint 持久化/加载/删除/复制, Agent 事件日志写入与恢复合并                                            |
| 不负责   | 聊天 UI 交互(→chat), SQLite 会话表的具体存储(→存储层)                                                                                                 |
| 关键约束 | 恢复时已成功执行的有副作用工具不得重放, 分支派生必须同步复制 checkpoint/事件日志/行动日志, checkpoint 与日志文件带版本号,解析失败安全降级             |
| 支撑链路 | create-session, resume-run, branch-session                                                                                                            |

## 执行链路

### Flow: branch-session

分支派生：复制运行 checkpoint 与事件日志到新分支

1. D-Git-Quick-Ai.src.main.ipc.cacheIpc.registerCacheIpc [✓] — 分支复制 IPC 入口
2. D-Git-Quick-Ai.src.main.agent.runCheckpoint.copyRunCheckpointsForRuns [✓] — 复制运行 checkpoint 到新分支

### Flow: create-session

运行上下文创建：主循环启动生命周期并建立 AgentRunContext

1. D-Git-Quick-Ai.src.main.agent.agentLoop.runAgentLoop [✓] — 主循环启动每次运行
2. D-Git-Quick-Ai.src.main.agent.agentRunLifecycle.startAgentRunLifecycle [✓] — 启动运行生命周期：建立 run 上下文与 manifest
3. D-Git-Quick-Ai.src.main.agent.AgentRunContext.createRun [✓] — 创建运行上下文（createRunManifest 为同级调用）

### Flow: resume-run

中断恢复：启动加载会话并合并中断运行的事件日志

1. D-Git-Quick-Ai.src.main.database.sessionStore.loadSessions [✓] — 应用启动加载会话记录
2. D-Git-Quick-Ai.src.main.agent.agentEventRecovery.mergeAgentEventJournalsIntoSessions [✓] — 合并中断运行的事件日志（单运行恢复另经 loadRunCheckpoint，DI 接线图不可见）

## 跨功能引用(注意:此链路上符号也属于)

- `D-Git-Quick-Ai.src.main.agent.agentLoop.runAgentLoop` → agent-run, file-snapshot, reasoning
