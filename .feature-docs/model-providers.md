# Feature: model-providers

> 状态: `待审`

模型服务商配置：provider 初始化、模型列表发现与结果缓存降级。

## 业务契约

| 项目 | 内容 |
|---|------|
| 触发 | 应用启动初始化设置;用户在设置界面增删改服务商、切换 API Key、触发模型列表发现 |
| 结果 | 成功:提供商/模型目录就绪,模型发现结果写入缓存;失败:发现失败时保留上次有效缓存,记录错误状态供 UI 提示 |
| 范围 | 设置初始化(initSettings), provider 注册校验, 模型发现策略与缓存(成功/失败分支) |
| 不负责 | 实际模型 API 调用(→agent-run modelCallRuntime) |
| 关键约束 | 核心预置服务商必须存在,缺失时自动补齐, API Key 存储必须安全,UI 只读掩码展示, 模型发现失败必须走缓存降级,不得阻塞会话发送 |
| 支撑链路 | model-discovery, provider-settings |


## 执行链路


### Flow: model-discovery

模型发现：渲染进程拉取模型列表并写入成功缓存

1. D-Git-Quick-Ai.src.renderer.src.hooks.useProviders.handleFetchModels [✓] — 渲染进程拉取模型列表
2. D-Git-Quick-Ai.src.shared.providerModelDiscoveryCache.completeProviderModelDiscovery [✓] — 发现成功写入缓存（失败分支走 failProviderModelDiscovery）


### Flow: provider-settings

Provider 初始化：应用启动时预取/写入模型发现缓存

1. D-Git-Quick-Ai.src.renderer.src.hooks.useProviders.initSettings [✓] — 应用启动初始化设置：provider 目录/API Key/模型缓存
2. D-Git-Quick-Ai.src.shared.providerModelDiscoveryCache.completeProviderModelDiscovery [✓] — 启动预取并写入模型发现缓存（失败降级用上次有效缓存）
