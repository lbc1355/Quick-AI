# Feature: file-operations

> 状态: `待审`

文件工具集：读/写/编辑/多编辑/复制/移动/删除/建目录，经工具派发管线执行。

## 业务契约

| 项目     | 内容                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 触发     | 模型在运行中调用文件类工具(fileRead/fileWrite/fileEdit/multiEdit/fileCopy/fileMove/fileDelete/directoryCreate)                                                     |
| 结果     | 成功:返回文件内容或变更结果(含 diff/校验);拒绝:路径越界、敏感文件命中、写入冲突,返回明确错误且不产生副作用                                                         |
| 范围     | 文件读/写/编辑/多编辑/复制/移动/删除/建目录, 结果归一化                                                                                                            |
| 不负责   | 路径授权策略(→agent-run toolCallPlanning), 工作区根管理                                                                                                            |
| 关键约束 | 所有路径必须通过路径安全校验(防逃逸到 workspace/project 根之外), 敏感文件(.env/.pem/凭据类)读取升级阻断, 写入/编辑必须返回可被模型消费的结果(校验/diff/新内容窗口) |
| 支撑链路 | tool-dispatch                                                                                                                                                      |

## 执行链路

### Flow: tool-dispatch

工具派发管线：Agent 回合经批量执行与收尾调用文件工具

1. D-Git-Quick-Ai.src.main.agent.toolTurnRunner.runToolTurn [✓] — Agent 回合执行文件工具
2. D-Git-Quick-Ai.src.main.agent.toolStepProcessor.processPreparedToolStep [✓] — 处理已规划的工具调用
3. D-Git-Quick-Ai.src.main.agent.toolBatchRunner.runPreparedToolBatch [✓] — 批量执行：按名称动态派发到 fileRead/fileWrite/fileEdit/multiEdit/fileCopy/fileMove/fileDelete/directoryCreate

## 跨功能引用(注意:此链路上符号也属于)

- `D-Git-Quick-Ai.src.main.agent.toolBatchRunner.runPreparedToolBatch` → agent-run
- `D-Git-Quick-Ai.src.main.agent.toolStepProcessor.processPreparedToolStep` → agent-run
- `D-Git-Quick-Ai.src.main.agent.toolTurnRunner.runToolTurn` → agent-run
