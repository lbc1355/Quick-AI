# Feature: shell-execution

> 状态: `待审`

Shell 执行：命令危险评级与阻断、前台命令执行、后台任务生命周期与持久化。

## 业务契约

| 项目     | 内容                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 触发     | 模型调用 shell 工具或后台 shell 工具(start/read/stop/list)                                                                                                     |
| 结果     | 成功:命令输出(stdout/stderr)返回;后台任务启动并可被读取/停止;拒绝:命令命中危险评级/黑名单,assertCommandNotDangerous 抛出阻断;失败:超时、输出超限、进程异常退出 |
| 范围     | 命令词法危险度评级, 前台/后台命令执行, 后台任务生命周期与持久化, 输出窗口读取                                                                                  |
| 不负责   | 权限询问交互(→agent-run)                                                                                                                                       |
| 关键约束 | 危险命令(评级/黑名单命中)必须无条件阻断, 前台命令必须有时限与输出上限,后台任务持久化以便跨运行读取, 命令输出兼容 Windows 编码(GBK 处理)                        |
| 支撑链路 | run-command, background-job                                                                                                                                    |

## 执行链路

### Flow: background-job

后台任务：启动后台 shell 任务并管理其进程

1. D-Git-Quick-Ai.src.main.tools.backgroundShell.executeBackgroundShellStart [✓] — 后台 shell 启动工具：评级 + 登记任务
2. D-Git-Quick-Ai.src.main.agent.backgroundJobManager.startBackgroundJob [✓] — 后台任务管理器登记/持久化任务

### Flow: deliver-background-result

后台任务结果投递：主进程路由后经 IPC 注入渲染端会话

1. D-Git-Quick-Ai.src.main.agent.backgroundShellDelivery.deliverBackgroundShellResult [✓] — 后台 shell 完成投递入口：组装结果提示词
2. D-Git-Quick-Ai.src.main.agent.backgroundResultDelivery.routeBackgroundResult [✓] — 路由：epoch 检查 + admit 持久化 + steer/queue
3. D-Git-Quick-Ai.src.renderer.src.features.chat.sessionPromptQueue.applyBackgroundShellNotification [✓] — 渲染端应用：steered 结果追加到 transcript 末尾（IPC 边界；排队结果重启后经 materializeBackgroundPrompt 物化并丢弃 stale）

### Flow: run-command

前台命令执行：危险评级通过后执行 shell 命令

1. D-Git-Quick-Ai.src.main.tools.shellExecutor.executeShellCommand [✓] — 前台 shell 命令执行入口
2. D-Git-Quick-Ai.src.main.agent.commandSafety.assertCommandNotDangerous [✓] — 词法危险评级与黑名单阻断（内部调用）
