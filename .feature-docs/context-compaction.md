# Feature: context-compaction

> 状态: `待审`

会话上下文压缩：/compact 用模型生成摘要并拼接进历史，可取消，压缩期间会话忙。

## 业务契约

| 项目     | 内容                                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 触发     | 用户执行 /compact 指令或点击压缩按钮                                                                                                                             |
| 结果     | 成功:模型摘要拼接进历史,contextEpoch+1,toast 反馈已总结条数;取消:AbortError 干净回滚且无错误提示;失败:错误 toast + 状态还原                                      |
| 范围     | 压缩触发与可压缩性校验, 模型摘要生成(compactContextWithModel), 结果拼接(applyCompactionResult), 压缩 dock 状态与计时, 取消压缩(cancelCompaction/abortCompaction) |
| 不负责   | 运行中的 stale 工具结果修剪(→agent-run), 自动上下文裁剪(→agent-run contextManager)                                                                               |
| 关键约束 | 压缩期间会话忙(阻止并发发送), 取消经 AbortController 中止主进程模型调用, 摘要插入到压缩边界之后,历史中间                                                         |
| 支撑链路 | compact-conversation                                                                                                                                             |

## 执行链路

### Flow: compact-conversation

/compact 压缩当前会话：调用模型生成摘要并拼接

1. D-Git-Quick-Ai.src.renderer.src.hooks.useChatCompletion.handleCompactCurrentSession [✓] — /compact 入口：可压缩校验、提交暂存、标记会话忙、设置压缩 dock 状态
2. D-Git-Quick-Ai.src.main.agent.contextCompactor.compactContextWithModel [✓] — 主进程压缩实现：构建压缩 prompt，调用模型生成摘要（IPC 边界，跨进程）
3. D-Git-Quick-Ai.src.main.agent.callModel.callModel [✓] — 模型调用（经 DI 默认接线，静态图不可见）

## 跨功能引用(注意:此链路上符号也属于)

- `D-Git-Quick-Ai.src.main.agent.callModel.callModel` → agent-run, chat
