# Feature: long-term-memory

> 状态: `待审`

Git 版本化长期记忆：记忆条目读写与自动提交，历史可追溯。

## 业务契约

| 项目     | 内容                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 触发     | Agent 运行产生可沉淀知识时写入;用户/模型主动读取记忆;应用启动加载常驻记忆                                                         |
| 结果     | 成功:记忆条目(always/task_group/rollout/raw)写入或读取完成,索引刷新;版本化:每次变更自动 Git 提交,历史可追溯                       |
| 范围     | 记忆文件读写, Task Group 管理, Git 版本化(ensureRepo/commit)                                                                      |
| 不负责   | 记忆内容注入提示词(→agent-run memoryContext/messageBuilder)                                                                       |
| 关键约束 | 只写入稳定可复用知识,禁止一次性上下文或未验证猜测, 敏感信息(密钥/一次性路径)不得写入, Git 不可用时降级为普通文件写入,不阻塞主流程 |
| 支撑链路 | memory-store, git-version-memory                                                                                                  |

## 执行链路

### Flow: git-version-memory

Git 版本化：确保仓库存在并提交记忆变更

1. D-Git-Quick-Ai.src.main.memory.memoryGit.ensureRepo [✓] — 确保记忆仓库存在（Git 降级处理）
2. D-Git-Quick-Ai.src.main.memory.memoryGit.commit [✓] — 提交记忆变更，历史可追溯

### Flow: memory-store

记忆条目读写：经记忆管理器写入/读取记忆条目

1. D-Git-Quick-Ai.src.renderer.src.components.MemoryManager.handleSave [✓] — 记忆管理器保存入口（渲染进程 UI）
2. D-Git-Quick-Ai.src.main.memory.memoryStore.writeMemoryEntry [✓] — 记忆条目写入（always/task_group/rollout/raw）
