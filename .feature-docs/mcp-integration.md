# Feature: mcp-integration

> 状态: `待审`

MCP 集成：stdio 服务器连接、工具列表同步与注册，失败清理与超时保护。

## 业务契约

| 项目 | 内容 |
|---|------|
| 触发 | 应用启动加载 MCP 配置;用户通过设置界面增删/重载服务器 |
| 结果 | 成功:stdio 客户端连接建立,工具列表拉取并注册进工具注册表;失败:连接超时/进程异常,清理客户端并移除该服务器工具,不影响其他服务器 |
| 范围 | MCP 服务器连接(connectServer), 工具列表同步与注册, 配置读写, 连接超时与失败清理 |
| 不负责 | 外部 MCP 服务器的内部实现, 工具在 Agent 中的权限策略(→agent-run) |
| 关键约束 | 连接必须有超时保护,失败必须清理半连接状态, 配置写入前必须 JSON 校验,非法配置拒绝保存, 服务器工具变更须刷新工具注册表,避免残留失效工具声明 |
| 支撑链路 | connect-servers |


## 执行链路


### Flow: connect-servers

MCP 服务器连接：初始化、重载、连接、拉取工具并注册

1. D-Git-Quick-Ai.src.main.mcpManager.McpManagerImpl.init [✓] — 启动时初始化 MCP：加载配置并连接所有服务器
2. D-Git-Quick-Ai.src.main.mcpManager.McpManagerImpl.reload [✓] — 重载配置并重连
3. D-Git-Quick-Ai.src.main.mcpManager.McpManagerImpl.connectServer [✓] — 建立 stdio 连接（带超时保护）
4. D-Git-Quick-Ai.src.main.mcpManager.McpManagerImpl.replaceServerTools [✓] — 将工具注册进工具注册表
5. D-Git-Quick-Ai.src.main.mcpManager.McpManagerImpl.createToolDefinition [✓] — 生成 MCP 工具定义（mcp_&lt;server&gt;_&lt;tool&gt; 命名）
