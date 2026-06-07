# QuickAI 技术架构文档

> 一个基于 Electron + React + TypeScript 的桌面 AI 助手应用，支持多模型、Agent 工具调用、会话管理和持久化缓存。

---

## 目录

1. [项目概览与技术栈](#1-项目概览与技术栈)
2. [Electron 多进程架构](#2-electron-多进程架构)
3. [目录结构总览](#3-目录结构总览)
4. [核心数据流](#4-核心数据流)
5. [Main Process 模块详解](#5-main-process-模块详解)
   - [5.1 应用入口 —— `src/main/index.ts`](#51-应用入口--srcmainindexts)
   - [5.2 持久化存储 —— `src/main/store.ts`](#52-持久化存储--srcmainstorets)
   - [5.3 Agent 运行上下文 —— `src/main/agent/AgentRunContext.ts`](#53-agent-运行上下文--srcmainagentagentruncontextts)
   - [5.4 Agent 主循环 —— `src/main/agent/agentLoop.ts`](#54-agent-主循环--srcmainagentagentloopts)
   - [5.5 工具注册中心 —— `src/main/toolRegistry.ts`](#55-工具注册中心--srcmaintoolregistryts)
   - [5.6 模型调用 —— `src/main/agent/callModel.ts`](#56-模型调用--srcmainagentcallmodelts)
   - [5.7 AI 客户端 —— `src/main/aiClient.ts`](#57-ai-客户端--srcmainaiclientts)
   - [5.8 消息构建器 —— `src/main/agent/messageBuilder.ts`](#58-消息构建器--srcmainagentmessagebuilderts)
   - [5.9 上下文管理器 —— `src/main/agent/contextManager.ts`](#59-上下文管理器--srcmainagentcontextmanagerts)
   - [5.10 权限管理器 —— `src/main/agent/permissionManager.ts`](#510-权限管理器--srcmainagentpermissionmanagerts)
   - [5.11 宪法守卫 —— `src/main/agent/constitution.ts`](#511-宪法守卫--srcmainagentconstitutionts)
   - [5.12 命令安全分析 —— `src/main/agent/commandSafety.ts`](#512-命令安全分析--srcmainagentcommandsafetyts)
   - [5.13 循环守卫 —— `src/main/agent/loopGuard.ts`](#513-循环守卫--srcmainagentloopguardts)
   - [5.14 重试策略 —— `src/main/agent/retryPolicy.ts`](#514-重试策略--srcmainagentretrypolicyts)
   - [5.15 Token 估算器 —— `src/main/agent/tokenEstimator.ts`](#515-token-估算器--srcmainagenttokenestimatorts)
   - [5.16 行动日志 —— `src/main/agent/actionLog.ts`](#516-行动日志--srcmainagentactionlogts)
   - [5.17 资源缓存 —— `src/main/resourceCache.ts`](#517-资源缓存--srcmainresourcecachets)
   - [5.18 Web 工具 —— `src/main/webTools.ts`](#518-web-工具--srcmainwebtoolsts)
   - [5.19 Agent 模块入口 —— `src/main/agent/index.ts`](#519-agent-模块入口--srcmainagentindexts)
6. [Preload 层详解](#6-preload-层详解)
7. [Renderer Process 模块详解](#7-renderer-process-模块详解)
   - [7.1 App 根组件 —— `src/renderer/src/App.tsx`](#71-app-根组件--srcrenderersrcapptsx)
   - [7.2 会话管理 Hook —— `src/renderer/src/hooks/useSessions.ts`](#72-会话管理-hook--srcrenderersrchooksusesessionsts)
   - [7.3 聊天补全 Hook —— `src/renderer/src/hooks/useChatCompletion.ts`](#73-聊天补全-hook--srcrenderersrchooksusechatcompletionts)
   - [7.4 服务商 Hook —— `src/renderer/src/hooks/useProviders.ts`](#74-服务商-hook--srcrenderersrchooksuseprovidersts)
   - [7.5 技能 Hook —— `src/renderer/src/hooks/useSkills.ts`](#75-技能-hook--srcrenderersrchooksuseskillsts)
   - [7.6 自动补全 Hook —— `src/renderer/src/hooks/useAutocomplete.ts`](#76-自动补全-hook--srcrenderersrchooksuseautocompletets)
   - [7.7 附件 Hook —— `src/renderer/src/hooks/useAttachments.ts`](#77-附件-hook--srcrenderersrchooksuseattachmentsts)
   - [7.8 UI 组件](#78-ui-组件)
8. [Shared 类型系统](#8-shared-类型系统)
9. [IPC 通道总览](#9-ipc-通道总览)
10. [缓存系统全景](#10-缓存系统全景)
11. [安全模型](#11-安全模型)
12. [测试体系](#12-测试体系)

---

## 1. 项目概览与技术栈

QuickAI 是一个 **uTools 风格的桌面 AI 助手**，通过 `Alt+/` 全局快捷键瞬间召唤/隐藏一个悬浮窗口，支持多 AI 服务商（DeepSeek、Kimi/Moonshot、Ollama 本地部署等），提供普通 Chat 和 Agent 两种对话模式。

| 层级 | 技术 | 用途 |
|------|------|------|
| **桌面容器** | Electron 39 | 窗口管理、系统托盘、全局快捷键 |
| **构建工具** | electron-vite 5 | 统一 main/preload/renderer 三端的构建 |
| **前端框架** | React 19 + TypeScript 5.9 | 渲染进程的 UI 层 |
| **UI 图标** | lucide-react | 矢量图标库 |
| **测试** | Vitest 4 | 单元测试（node 环境） |
| **代码规范** | ESLint 9 + Prettier 3 | 代码风格与检查 |
| **包管理** | npm | 依赖管理 |

---

## 2. Electron 多进程架构

```
┌──────────────────────────────────────────────────────────┐
│                     Main Process                         │
│  (src/main/)                                             │
│                                                          │
│  ┌──────────┐  ┌─────────────┐  ┌────────────────────┐  │
│  │ index.ts │  │ aiClient.ts │  │ agent/              │  │
│  │ 窗口管理  │  │ 简单Chat    │  │   agentLoop.ts      │  │
│  │ IPC注册  │  │             │  │   callModel.ts      │  │
│  │ 全局快捷键│  │             │  │   messageBuilder.ts │  │
│  └──────────┘  └─────────────┘  │   permissionManager │  │
│                                  │   constitution.ts   │  │
│  ┌──────────┐  ┌─────────────┐  │   contextManager.ts │  │
│  │ store.ts │  │toolRegistry │  │   loopGuard.ts      │  │
│  │ 持久化存储│  │ 工具注册中心 │  │   ActionLog.ts     │  │
│  └──────────┘  └─────────────┘  │   ...               │  │
│                                  └────────────────────┘  │
│  ┌──────────────┐  ┌──────────────────────────────────┐  │
│  │resourceCache │  │ webTools.ts                      │  │
│  │ 资源文件缓存  │  │ fetchUrl / webSearch / HTML解析   │  │
│  └──────────────┘  └──────────────────────────────────┘  │
│                                                          │
│  ═══════════════ IPC Bridge ═══════════════              │
│         contextBridge.exposeInMainWorld                   │
└──────────────────────────────────────────────────────────┘
                           │
                           │  ipcRenderer.invoke / .send / .on
                           │
┌──────────────────────────────────────────────────────────┐
│                    Preload Layer                          │
│  (src/preload/)                                           │
│                                                          │
│  index.ts — 暴露 window.api 对象给渲染进程：                │
│    storeGet/Set, startChatCompletion, startAgentSkill,    │
│    respondToolPermission, abortGeneration,                │
│    clearSessionCaches, fetchModels, onChatChunk, ...      │
└──────────────────────────────────────────────────────────┘
                           │
                           │  window.api.*
                           │
┌──────────────────────────────────────────────────────────┐
│                   Renderer Process                        │
│  (src/renderer/src/)                                      │
│                                                          │
│  App.tsx — 主界面                                         │
│  hooks/                                                   │
│    useChatCompletion.ts — 聊天/Agent 运行流管理             │
│    useSessions.ts — 多会话 CRUD + 缓存清理                  │
│    useProviders.ts — 多服务商配置管理                       │
│    useSkills.ts — Markdown Skill 安装/管理                 │
│    useAutocomplete.ts — / 命令自动补全                      │
│    useAttachments.ts — 文件拖拽/粘贴上传                    │
│  components/                                              │
│    MessageBubble.tsx — 消息气泡渲染                         │
│    SettingsView.tsx — 设置面板                              │
│    ModelsModal.tsx — 模型选择弹窗                           │
│    ProviderEditor.tsx — 服务商编辑器                        │
│    ProviderList.tsx — 服务商列表                            │
│    SkillManager.tsx — Skill 管理器                          │
│    FilePreviewList.tsx — 附件预览列表                       │
│  utils/                                                   │
│    messageFormat.tsx — 消息格式化（Markdown渲染、代码高亮）   │
│    skillMarkdown.ts — SKILL.md 解析                         │
│    providerPresets.ts — 服务商预设模板                      │
└──────────────────────────────────────────────────────────┘
```

**关键设计原则：**
- **Main 进程** 拥有所有 Node.js 能力（文件系统、网络请求、子进程），是唯一的"事实来源"
- **Preload 层** 通过 `contextBridge` 暴露有限 API —— 渲染进程永远无法直接访问 `fs`、`electron` 等原生模块
- **Renderer 进程** 纯 UI 逻辑，通过 `window.api` 单向调用 main，通过 `window.api.onChatChunk` 订阅 main 推送的事件流

---

## 3. 目录结构总览

```
D:\Git\Quick Ai\
├── package.json                 # 项目配置、脚本、依赖
├── tsconfig.json                # 根 TS 配置
├── tsconfig.node.json           # Main + Preload 的 TS 配置
├── tsconfig.web.json            # Renderer 的 TS 配置
├── ARCHITECTURE.md              # 本技术文档
│
├── src/
│   ├── shared/                  # 三端共享的纯类型定义
│   │   └── types.ts             # 所有接口/类型/enum（约250行）
│   │
│   ├── main/                    # Main Process
│   │   ├── index.ts             # 应用入口：窗口/Tray/快捷键/IPC注册
│   │   ├── store.ts             # 文件存储 (JSON file-based KV store)
│   │   ├── aiClient.ts          # 简单 Chat 模式的入口
│   │   ├── toolRegistry.ts      # 工具注册中心 + 工具定义 + 工具发现 (~1580行)
│   │   ├── resourceCache.ts     # 资源缓存 (fetch_url 结果的磁盘缓存)
│   │   ├── webTools.ts          # Web 抓取/搜索 + HTML 解析
│   │   ├── fileTools.test.ts    # 文件工具单元测试
│   │   ├── webTools.test.ts     # Web 工具单元测试
│   │   ├── resourceCache.test.ts
│   │   └── agent/               # Agent 子系统
│   │       ├── index.ts         # 对外导出 (runAgentSkill, runGeneralAgent, ...)
│   │       ├── AgentRunContext.ts # 单次 Agent Run 的运行时状态
│   │       ├── agentLoop.ts     # Agent 主循环 (ReAct 模式)
│   │       ├── callModel.ts     # 调用 LLM API (SSE 流式解析)
│   │       ├── messageBuilder.ts # 系统提示词构建 + Skill 消息打包
│   │       ├── contextManager.ts # 上下文窗口截断策略
│   │       ├── permissionManager.ts # 工具权限的 Promise-based 等待机制
│   │       ├── constitution.ts  # 结构化守卫策略 (参数级别 escalate)
│   │       ├── commandSafety.ts # Shell 命令危险等级分类
│   │       ├── loopGuard.ts     # 循环检测 + 连续失败熔断
│   │       ├── retryPolicy.ts   # 网络请求重试策略
│   │       ├── tokenEstimator.ts # 轻量级 Token 估算
│   │       ├── actionLog.ts     # 行动日志 (per-conversation JSONL)
│   │       └── *.test.ts        # 对应单元测试
│   │
│   ├── preload/                 # Preload Script
│   │   ├── index.ts             # contextBridge 暴露 API
│   │   └── index.d.ts           # 类型声明 (Window.api 接口)
│   │
│   └── renderer/                # Renderer Process
│       └── src/
│           ├── main.tsx         # React 入口
│           ├── App.tsx          # 根组件 (状态编排 + 权限弹窗 + 布局)
│           ├── env.d.ts         # Vite 环境类型声明
│           ├── hooks/
│           │   ├── useSessions.ts      # 多会话管理
│           │   ├── useChatCompletion.ts # 聊天/Agent 运行流
│           │   ├── useProviders.ts     # 多服务商配置
│           │   ├── useSkills.ts        # Skill 安装/删除
│           │   ├── useAutocomplete.ts  # / 命令自动补全
│           │   ├── useAttachments.ts   # 文件上传管理
│           │   ├── useSessions.test.ts # computeOrphanResourceIds 单测
│           │   └── useChatCompletion.test.ts (空占位)
│           ├── components/
│           │   ├── MessageBubble.tsx   # 消息渲染 (Markdown/代码块/事件流)
│           │   ├── SettingsView.tsx    # 设置面板
│           │   ├── ModelsModal.tsx     # 模型选择弹窗
│           │   ├── ProviderEditor.tsx  # 服务商编辑表单
│           │   ├── ProviderList.tsx    # 服务商列表
│           │   ├── SkillManager.tsx    # Skill 管理
│           │   ├── FilePreviewList.tsx # 附件预览
│           │   └── Versions.tsx        # 版本信息展示
│           └── utils/
│               ├── messageFormat.tsx   # Markdown 渲染 (含 KaTeX/代码高亮)
│               ├── skillMarkdown.ts    # SKILL.md 解析器
│               └── providerPresets.ts  # 服务商预设模板
```

---

## 4. 核心数据流

### 4.1 用户发送消息的完整路径

```
用户输入 → Enter
  │
  ▼
App.tsx: handleSendMessage()
  │
  ├─ 构造 userMsg → setSessions 更新 UI
  ├─ 构造 assistantMsg 占位 → setSessions 更新 UI
  ├─ 收集历史消息 → 转换文件为多模态格式
  │
  ├─ runMode === 'agent' ?
  │    YES → window.api.startChatCompletion(reqId, {..., runMode:'agent'})
  │    NO  → window.api.startChatCompletion(reqId, {..., runMode:'chat'})
  │
  ▼  ═══ IPC (send) ═══
  │
  ▼
Main: index.ts ipcMain.on('start-chat-completion', ...)
  │
  ├─ runMode === 'agent' ?
  │    YES → runGeneralAgent(win, reqId, options, permissions)
  │    NO  → handleChatCompletion(win, reqId, options)
  │
  ▼
agent/agentLoop.ts: runAgentLoop()
  │
  ├─ 1. 准备 messages (系统提示词 + 工具目录 + 资源摘要)
  ├─ 2. 创建 ActionLog (per-session JSONL)
  ├─ 3. 创建 AgentRunContext (activeTools, toolScope, AbortController, toolOutputs)
  ├─ 4. 动态模式: 预激活所有 discoverable 工具
  │
  ├─ 5. FOR step = 1..maxSteps:
  │   ├─ callModel(messages, toolsToDeclare, signal, callbacks)
  │   │   └─ POST /chat/completions (SSE stream)
  │   │       ├─ reasoning_content → sendEvent('reasoning')
  │   │       ├─ tool_calls delta → accumulate
  │   │       └─ content delta → sendEvent('final')
  │   │
  │   ├─ 分类 tool_calls:
  │   │   ├─ askCalls: 需要用户确认 → requestPermission (async await)
  │   │   ├─ directCalls: 允许直接执行 → 并发执行
  │   │   └─ blockedCalls: 被拒绝/无效 → 直接返回错误
  │   │
  │   ├─ 执行工具:
  │   │   ├─ evaluateToolGuard (constitution 参数级 escalate)
  │   │   ├─ loopGuard.recordCall (重复调用检测)
  │   │   ├─ toolDef.execute(args, ctx) with retry
  │   │   ├─ 大输出 → storeToolOutput → activateTool('read_tool_output')
  │   │   └─ recordAction → ActionLog.append
  │   │
  │   └─ 无 tool_calls → setRunEnd('completed') → break
  │
  ├─ 6. (如达到 maxSteps 或被 halt) 请求 best-effort final answer
  │
  └─ 7. finally: actionLog.save() + destroyRun(reqId)
  │
  ▼  ═══ BrowserWindow.webContents.send('chat-chunk', data) ═══
  │
  ▼
Renderer: window.api.onChatChunk callback
  │
  ├─ data.reasoningContent → updateMessageById (reasoning)
  ├─ data.content → updateMessageById (accumulated text)
  ├─ data.event.type === 'tool_call' → applyAgentEventToMessage
  ├─ data.event.type === 'resource_update' → merge session resources
  └─ data.done → cleanup (unsubscribe, persistActiveSession)
```

### 4.2 权限请求的路径

```
agentLoop: askCalls
  │
  ├─ sendEvent('tool_call', {permissionState:'pending'})
  │   └─ 渲染进程显示权限弹窗
  │
  ├─ globalPermissionManager.requestPermission(reqId, callId)
  │   └─ 返回 Promise<boolean>（10分钟超时）
  │
  ▼  [用户在 UI 上选择允许/拒绝]
  │
App.tsx: handlePermissionResponse(approved)
  │
  ├─ window.api.respondToolPermission(agentRunId, callId, approved)
  │   ═══ IPC (send) ═══
  │
Main: resolveToolPermission(reqId, callId, approved)
  │
  ├─ globalPermissionManager.resolve(reqId, callId, approved)
  │   └─ 解析之前挂起的 Promise
  │
  ▼
agentLoop: isApproved = await requestPermission(...)
  │
  ├─ approved? → executeTool(prep, true)
  └─ denied?  → executeTool(prep, false) → 返回 "denied by user" 错误
```

---

## 5. Main Process 模块详解

### 5.1 应用入口 —— `src/main/index.ts`

**职责：** Electron 主进程生命周期管理、IPC 注册、窗口/Tray/快捷键。

**核心流程：**

```
app.whenReady()
  ├─ new FileStore()                    # 初始化文件持久化
  ├─ 注册 IPC handlers:
  │   ├─ 'store-get' / 'store-set'     # 白名单保护的 KV 读写
  │   ├─ 'get-app-info'                # 获取存储路径和版本
  │   ├─ 'clear-session-caches'        # 批量删除 ActionLog + Resource 文件
  │   ├─ 'fetch-models'                # 从 API 获取可用模型列表
  │   ├─ 'hide-window'                 # 隐藏窗口到屏幕外
  │   ├─ 'set-file-picker-active'      # 标记文件选择器活跃状态
  │   ├─ 're-summon-window'            # 重新显示窗口
  │   ├─ 'toggle-devtools'             # 开关 DevTools
  │   ├─ 'start-chat-completion'       # 启动 Chat 或 Agent 模式
  │   ├─ 'start-agent-skill'           # 启动 Agent Skill
  │   ├─ 'respond-tool-permission'     # 用户响应工具权限请求
  │   └─ 'abort-generation'            # 中止当前生成
  ├─ createWindow()                    # 创建透明无边框窗口
  ├─ createTray()                      # 系统托盘图标 + 右键菜单
  └─ registerGlobalShortcut()          # 注册 Alt+/ 全局快捷键
```

**窗口管理策略：**
- 窗口初始位置在屏幕外 `(-9999, -9999)`，加载完成后通过 `showInactive()` 预绘制
- 显示/隐藏通过 `setOpacity(0/1)` + `setPosition` 实现 —— 避免 `show()/hide()` 触发 Windows 原生动画
- 失焦自动隐藏（可配置 `autoHideOnBlur`）
- 文件选择器激活时不触发自动隐藏

**IPC 安全：**
- `store-get/store-set` 使用 `ALLOWED_STORE_KEYS` 白名单：`['sessions', 'settings', 'skills', 'memories']`
- `clear-session-caches` 对 `payload.sessionIds` 和 `payload.resourceIds` 做类型校验（`typeof === 'string'`），使用 `Promise.allSettled` 确保一个失败不阻塞其余删除

### 5.2 持久化存储 —— `src/main/store.ts`

**职责：** 基于单一 JSON 文件的持久化 KV 存储，带有旧版本迁移逻辑。

**核心设计：**
- 存储位置：`{app.getPath('userData')}/quickai_store.json`
- 数据结构：`StorageSchema { sessions, settings, skills, memories }`
- 读写策略：启动时全量读入内存缓存，每次 `set()` 同步写盘
- **迁移逻辑（旧版本兼容）：**
  1. 过滤内置默认 skill triggers（`explain`、`review` 等）将其彻底删除
  2. 将旧格式的 `apiKey/apiUrl/model/modelsList` 迁移为多服务商 `providers[]` 结构
  3. 补充缺失的 `type` 字段（通过 URL 自动检测 DeepSeek/Kimi/Ollama）
  4. 合并默认 permissions —— 新增工具的默认权限不会被旧设置覆盖

### 5.3 Agent 运行上下文 —— `src/main/agent/AgentRunContext.ts`

**职责：** 单次 Agent Run 的所有运行时状态容器。以 `reqId` 为 key 存储在模块级 `Map` 中，供工具执行时通过 `getRun(reqId)` 获取。

**类结构：**

```
AgentRunContext
  ├─ 状态标记
  │   ├─ status: 'running'|'completed'|'cancelled'|'failed'|'max_steps'
  │   ├─ startedAt, completedAt, error
  │   └─ currentStep, maxSteps
  │
  ├─ 工具控制
  │   ├─ activeTools: Set<string>         # 已激活可用工具
  │   ├─ executedCalls: Set<string>       # 已执行的 fetch_url 组合键
  │   └─ toolScope: Set<string> | 'all'   # Skill 的工具域限制
  │
  ├─ 生命周期
  │   ├─ controller: AbortController      # 用户中止信号
  │   └─ signal: AbortSignal              # 只读访问器
  │
  ├─ 权限
  │   ├─ permissionPolicy                 # 工具级别 allow/ask/deny
  │   └─ permissions (PermissionManager)  # 用于 cleanup
  │
  ├─ 工具输出存储 (Tool Output Store)  ← 内存 Map，5MB FIFO 上限
  │   ├─ storeToolOutput(callId, text)    # 存入，溢出时淘汰最旧
  │   └─ getToolOutput(callId)            # 读取
  │
  └─ actionLog: ActionLog                 # per-conversation 追加日志
```

**模块级函数：**

| 函数 | 作用 |
|------|------|
| `createRun(reqId, initialTools, toolScope, actionLog, permissionPolicy)` | 创建并注册 Run |
| `getRun(reqId)` | 通过 reqId 查找 Run |
| `abortRun(reqId)` | 触发 AbortController |
| `destroyRun(reqId)` | abort + 从 Map 删除 |

**Tool Output Store 机制：**
- 当工具返回的输出超过 `TOOL_OUTPUT_SPILLOVER_THRESHOLD`（2000 chars）时，完整内容被存入此 Store
- 上下文管理器截断旧消息中的大输出时，会留下 `read_tool_output(output_id="xxx")` 指针
- 上限 5MB，FIFO 淘汰最旧的条目

### 5.4 Agent 主循环 —— `src/main/agent/agentLoop.ts`

**职责：** Agent 模式的核心执行引擎，实现 ReAct（Reasoning + Acting）循环。是代码量最大的单文件（~690 行）。

**函数签名：**

```typescript
runAgentLoop(mainWindow, reqId, options, permissions?)
```

**参数 `options`：**
- `apiUrl, apiKey, model` — LLM 配置
- `systemPrompt?` — 全局自定义系统提示词
- `messages?` — 已有的聊天历史
- `skill?` — Skill 对象（skill 模式时传入）
- `userInput?` — 用户输入
- `resources?` — 会话已缓存的资源列表
- `sessionId?` — 会话 ID（用于 ActionLog 持久化）

**主循环流程（伪代码）：**

```
1. 确定 toolDiscovery 模式:
   - Skill 且 toolDiscovery !== 'dynamic' → static (仅 skill.tools)
   - 否则 → dynamic

2. 准备 messages:
   - Skill: buildSkillMessages({skill, userInput, resources})
   - General: prepareChatAgentMessages(messages, systemPrompt, resources, permissions)

3. 创建 ActionLog(conversationId / reqId)

4. 创建 AgentRunContext:
   - 初始 activeTools = dynamic模式? ['search_tools'] : skill.tools
   - 动态模式: 预激活所有 discoverable 工具  ← 修复 permission bug 的关键
   - 如有 resources: 预激活 read_cached_resource + search_cached_resource

5. 初始化 LoopGuard, fetchUrlsCount=0, haltRequested=false

6. FOR step = 1..maxSteps:
   a. 构建 toolsToDeclare (仅 activeTools 中且非 deny 的)
      - 缓存声明列表，仅在 activeTools 变化时重建

   b. trimMessagesToFit(messages, {maxTokens, reserveForResponse:2000})

   c. assistantMessage = callModel(messages, toolsToDeclare, signal, callbacks)
      - 流式回调: onReasoning → sendEvent('reasoning')
                   onFinalChunk → sendEvent('final')

   d. 如无 tool_calls → setRunEnd('completed') → 结束

   e. 预处理 tool_calls → PreparedCall[]:
      - 解析 args JSON
      - 白名单检查 (isValid)
      - evaluateToolGuard (参数级 escalate)
      - fetch_url 去重检测 (isDeadlock)
      - loopGuard.recordCall (重复调用检测 → loopBlock)
      - 分类: ask / direct / blocked

   f. 串行处理 askCalls → 每个发送 sendEvent('tool_call', pending)
      → await permissionManager.requestPermission() → executeTool

   g. 并发处理 directCalls → executeTool(prep, true)

   h. 并发处理 blockedCalls → executeTool(prep, false) → 返回错误/警告

   i. 如 haltRequested → break (跳出循环请求 final answer)

7. 如达到 maxSteps 或 halt → 追加提示消息 → callModel (final answer)

8. catch: 区分 abort/真实错误 → setRunEnd

9. finally: actionLog.save() + destroyRun(reqId)
```

**`executeTool` 内部逻辑（7 个 return 路径，全部记录 actionLog）：**

```
executeTool(prep, isApproved)
  ├─ !isValid || permission==='deny' → recordAction('denied') → return 错误消息
  ├─ isDeadlock → recordAction('blocked') → return 去重警告
  ├─ loopBlock → recordAction('blocked') → return 循环阻断消息
  ├─ fetch_url 超限 → recordAction('blocked') → return 限制警告
  ├─ !isApproved → recordAction('denied') → return 用户拒绝消息
  ├─ toolDef.execute(args, ctx) with retry
  │   ├─ 成功 → recordAction('success') → return 结果
  │   └─ 失败 → recordAction('error') → return 错误信息
  └─ 大输出 (>2000 chars) → storeToolOutput + activateTool('read_tool_output')
```

### 5.5 工具注册中心 —— `src/main/toolRegistry.ts`

**职责：** 定义所有可用工具、提供搜索/发现、执行。这是项目最大的单文件（~1580 行）。

**架构设计：**

```
ToolRegistry: Record<string, ToolDefinition>
  │
  ├─ 工具定义接口:
  │   ToolDefinition {
  │     name, title, description, tags[], category, risk,
  │     implemented, discoverable, dependencies[], parameters, execute()
  │   }
  │
  ├─ 工具分类:
  │   ├─ web:     fetch_url, web_search
  │   ├─ file:    file_read, file_write, workspace_search, workspace_list_files
  │   ├─ system:  search_tools, read_cached_resource, search_cached_resource,
  │   │           read_tool_output
  │   ├─ memory:  list_past_actions, get_past_action
  │   └─ shell:   shell (stub, 未实现)
  │
  ├─ 搜索函数:
  │   searchToolDefinitions(query, scope, permissionPolicy)
  │     ├─ query='' → 返回全部 discoverable 工具
  │     ├─ 中英文关键词匹配 + 评分排序
  │     └─ 过滤 deny 权限的工具
  │
  └─ 辅助函数:
      toChatToolDeclaration(tool) → ChatToolDeclaration
      getWorkspaceRoot() → ~/quickai/
      isPathInWorkspace(filePath) → boolean
      isSensitiveFile(filePath) → boolean
```

**工具总览（11 个已实现 + 1 个未实现）：**

| 工具名 | 分类 | 风险 | 功能简述 |
|--------|------|------|----------|
| `fetch_url` | web | low | 抓取网页内容，支持分页（offset/nextOffset） |
| `web_search` | web | low | 搜索引擎聚合（Bing → Sogou → DuckDuckGo 级联回退） |
| `file_read` | file | low | 读取 workspace 内文件（≤2MB） |
| `file_write` | file | medium | 写入文件到 workspace（create/overwrite 模式） |
| `workspace_search` | file | low | workspace 内文本搜索（类 grep） |
| `workspace_list_files` | file | low | Glob 模式匹配文件列表 |
| `search_tools` | system | low | 动态工具发现（meta-tool） |
| `read_cached_resource` | system | low | 读取已缓存网页的指定 chunk |
| `search_cached_resource` | system | low | 在缓存资源中搜索关键词 |
| `read_tool_output` | system | low | 检索被上下文管理器截断的大工具输出 |
| `list_past_actions` | memory | low | 列出本次会话的历史工具调用摘要 |
| `get_past_action` | memory | low | 获取特定历史工具调用的完整详情 |
| `shell` | shell | high | 🚧 未实现（stub） |

**每个工具的 `execute()` 函数接收两个参数：**
- `args: ToolArgs` — 解析后的工具参数（已从 JSON 字符串解析为对象）
- `ctx: ToolExecutionContext { reqId, signal, mainWindow }` — 运行上下文

**`search_tools` 的特殊行为：**
- 调用时不仅返回匹配的工具摘要，还会自动将结果中的工具及其依赖项激活到当前 Run 的 `activeTools` 中
- 这是动态工具发现的核心机制

### 5.6 模型调用 —— `src/main/agent/callModel.ts`

**职责：** 调用 OpenAI 兼容的 `/chat/completions` 端点，解析 SSE 流式响应。Agent 和简单 Chat 共用此模块。

**关键细节：**

1. **请求构建：**
   - 自动补全 URL 后缀 `/chat/completions`
   - 对 assistant 消息做 sanitize：删除 `reasoning_content`（部分兼容 API 不接受此字段）
   - 有 tools 时设 `tool_choice: 'auto'`，开启流式

2. **SSE 流解析（状态机）：**
   ```
   delta.reasoning_content → accumulate + emitReasoning
   delta.tool_calls[]       → 按 index 构建 tool_call 对象（增量拼接）
   delta.content            → 处理本地 <think> 标签 → emitReasoning / emitFinal
   ```

3. **`<think>` 标签流式处理：**
   - 在字符流中实时追踪 `<think>...</think>` 边界
   - 标签内内容 → `reasoning_content`
   - 标签外内容 → `content`
   - 支持跨 SSE chunk 的标签（`inThinkTag` 状态）

4. **重试策略：**
   - 仅在没有用户可见内容流式输出前重试（`streamingStarted === false`）
   - 一旦有 chunk 发给 UI，失败立即抛出（防止重复显示）
   - 重试退避：baseDelay × 2^attempt，上限 maxDelay

5. **final 补偿发送：**
   - 当工具调用轮次中 `shouldStreamFinal === false` 时，不会流式发送内容
   - 但在没有 tool_calls 时（纯文本回答），在返回前一次性 `emitFinal`

### 5.7 AI 客户端 —— `src/main/aiClient.ts`

**职责：** 简单 Chat 模式的处理入口 + 模型列表获取 + 会话中断管理。

**两个入口：**

```
handleChatCompletion(win, reqId, options)
  ├─ 创建 AbortController，注册到 activeChatSessions
  ├─ 调用 callModel (无 tools)
  └─ finally: 从 activeChatSessions 删除

fetchModels(fetchUrl, apiKey)
  ├─ GET 请求 → 兼容多种响应格式
  ├─ data: {data: [{id}]} | {models: [{name/model/id}]} | [string]
  └─ 返回 modelIds: string[]
```

### 5.8 消息构建器 —— `src/main/agent/messageBuilder.ts`

**职责：** 为 Agent 和 Skill 构建发送给 LLM 的完整消息列表，包括系统提示词、工具目录、资源摘要。

**主要导出：**

| 函数 | 用途 |
|------|------|
| `buildToolDirectorySummary(scope, permissionPolicy)` | 生成紧凑的工具目录（≤2000 chars）注入系统提示词 |
| `buildResourceSummaryPrompt(resources)` | 生成会话资源摘要（≤4000 chars），包含 chunk 覆盖状态 |
| `buildSkillMessages(options)` | 为 Skill 模式构建消息 |
| `prepareChatAgentMessages(messages, systemPrompt, resources, permissions)` | 为 General Agent 模式构建消息 |

**General Agent 的系统提示词包含：**
- 全局自定义 systemPrompt（如有）
- 工具目录摘要（预激活的工具列表）
- 行为规则：
  - 直接调用已列出的工具，无需先 search_tools
  - 使用 `search_tools` 发现更多工具
  - **调用 `list_past_actions` 检查历史，避免重复工作**
  - 优先 fetch 搜索结果中最相关的 1-3 个 URL
  - 长页面使用分页参数持续获取
  - 最终答案标注来源 URL

**`buildResourceSummaryPrompt` 的特殊处理：**
- 按 `updatedAt` 降序排列资源
- 检测 fetchedRange 覆盖缺口，标记 `status: 'partial'` + `nextOffset`
- 区分 `status: 'stale'`（过期）和实际的 `partial`（未读完）
- 预算控制：超过 4000 字符截断

### 5.9 上下文管理器 —— `src/main/agent/contextManager.ts`

**职责：** 管理 LLM 上下文窗口，防止超出 token 限制导致 API 错误或 truncation。

**核心函数：**

**`getContextWindowSize(modelName): number`**
- 已知模型查表（DeepSeek, Kimi/Moonshot, GPT-4o）
- 动态推断：从模型名后缀 `-128k`、`_32k`、`-1m` 提取
- 默认 16000 tokens

**`trimMessagesToFit(messages, options): ChatCompletionMessage[]`**

采用两阶段截断策略：

```
Phase 1: 工具输出修剪
  ├─ 保护 system prompt (index 0) 和尾部 4 条消息
  ├─ 对中间的大工具输出（>500 chars）进行截断
  └─ 如原始输出在 output store 中 → 留下 read_tool_output 指针

Phase 2: 消息单元删除
  ├─ 保护 system prompt + 尾部 4 条
  ├─ 以 "assistant(with tool_calls) + 后续 tool 消息" 为不可分割单元
  └─ 从 index 1 开始删除最旧的单元，直到预算满足
```

### 5.10 权限管理器 —— `src/main/agent/permissionManager.ts`

**职责：** 实现 ask 权限的异步等待机制。Agent 循环在需要用户确认时挂起，用户通过 UI 响应后继续。

**设计：**
- 每个待定权限请求存储为 `{resolve, reject, timeoutId}`
- 以 `${reqId}:${callId}` 为 key
- 10 分钟超时（`timeoutMs = 10 * 60 * 1000`）
- `cleanupForRun(reqId)` 在 Run 终止时清理所有挂起的权限请求

**实例：** `globalPermissionManager` —— 模块级单例。

### 5.11 宪法守卫 —— `src/main/agent/constitution.ts`

**职责：** 结构化的工具守卫策略。在执行工具前，根据参数内容**升级**（从不降级）静态权限。

**核心函数：** `evaluateToolGuard(toolName, args, basePermission, risk, constitution?)`

**守卫规则（按优先级）：**

| 规则 | 触发条件 | 动作 |
|------|----------|------|
| 路径逃逸 | 文件路径含绝对路径/`~`/`$HOME`/`..` 越界 | `deny` |
| 敏感文件 | 文件名匹配 `.env`/`.pem`/`.key`/SSH key 等 | `ask` |
| 危险命令 | `analyzeCommand` 返回 `dangerous` | `deny` |
| 需确认命令 | `analyzeCommand` 返回 `requires_approval` | `ask` |
| 高风险工具 | `risk === 'high'` + `escalateHighRiskToAsk` | `ask` |

**设计原则：** 权限制只能收紧，不能放宽（`stricter()` 取两者的更高安全等级）。

### 5.12 命令安全分析 —— `src/main/agent/commandSafety.ts`

**职责：** 纯词法分析的 Shell 命令安全分类。无文件系统依赖，可直接单测。

**两个导出函数：**

**`pathEscapesWorkspace(inputPath): boolean`**
- 检测绝对路径、`~`、`$HOME`/`%USERPROFILE%`、`..` 遍历
- 不触碰 fs，纯字符串分析

**`analyzeCommand(command): CommandSafetyVerdict`**

分类等级：

| 等级 | 条件 |
|------|------|
| `dangerous` | null 字节、多行命令、管道 curl→sh、fork bomb、`mkfs/dd/shutdown/reboot`、`rm -rf` 危险目标、`eval` |
| `requires_approval` | `rm`（非危险目标）、`find -delete`/`-exec rm`、未知命令 |
| `safe` | 只读命令：`ls/cat/echo/pwd/whoami/head/tail/grep/find/wc/stat/date/which/env` |

**`tokenizeCommand`** 实现了最小化的 shell 风格分词器（支持单双引号）。

### 5.13 循环守卫 —— `src/main/agent/loopGuard.ts`

**职责：** 在硬性的 `maxSteps` 上限之外提供行为级别的循环保护。

**两类保护：**

**1. 相同调用阻断（Identical-call blocking）：**
- 对 `(toolName, args)` 计算稳定签名（递归排序 JSON keys）
- 同一签名调用 ≥3 次 → block，告知模型使用已有结果或改变方法

**2. 连续失败熔断（Consecutive-failure escalation）：**
- 同一工具连续失败 ≥3 次 → warn（提示模型换方法）
- 同一工具连续失败 ≥8 次 → halt（强制结束工具使用，进入 final answer）

### 5.14 重试策略 —— `src/main/agent/retryPolicy.ts`

**职责：** 网络请求的指数退避重试。

**默认策略：**
- 最多 2 次重试（共 3 次尝试）
- 退避：1s → 2s → 5s (上限)
- 仅重试瞬态错误：`ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`, `fetch failed`, `network error`

**`withRetry(fn, policy, signal)`**
- 支持通过 AbortSignal 在重试等待期间响应中止
- 等待期间监听 `signal.addEventListener('abort', ...)` 及时退出

### 5.15 Token 估算器 —— `src/main/agent/tokenEstimator.ts`

**职责：** 轻量级 token 数估算，用于上下文窗口管理（无需调用 API）。

**算法：**
- 英文/代码：~4 字符/token
- CJK（中日韩）：~1.5 字符/token
- 每条消息额外 +4 tokens（角色/格式开销）
- 支持 `tool_calls` 和 `reasoning_content` 的 token 估算

### 5.16 行动日志 —— `src/main/agent/actionLog.ts`

**职责：** 记录 Agent 每次工具调用的结构化日志，持久化为 JSONL，并作为 `list_past_actions` / `get_past_action` 工具的数据源。

**设计要点：**

```
ActionRecord {
  callId, turnIndex, timestamp, toolName,
  args (redacted), resultStatus, resultSummary (500 chars),
  resultSize, resultInOutputStore,
  permission ('allow'|'ask'|'deny'), durationMs
}
```

**存储：**
- 位置：`{userData}/action_logs/{sessionId}.jsonl`
- 格式：每行一个 JSON 对象
- 上限：内存中最多 500 条（FIFO），超出时淘汰最旧

**敏感信息保护：**
- `SENSITIVE_ARG_KEYS` 集合：`apiKey`, `api_key`, `token`, `password`, `passwd`, `secret`, `credential`, `authorization`, `auth`, `key`, `cert`, `privateKey`, `private_key`
- `redactArgs()` 递归处理嵌套对象，匹配到敏感 key 替换为 `[redacted]`
- 注意：脱敏发生在 **append 时**，内存中的对象是脱敏后的副本

**API：**
- `append(record)` — 追加一条记录
- `list({toolName?, fromTurn?, toTurn?, limit?})` — 分页列表（最新优先）
- `get(callId)` — 获取单条完整记录
- `size` — getter，当前记录数
- `save()` — 完整写盘（用于 Run 结束时的 final flush）

**辅助函数：**
- `getActionLogPath(conversationId)` — 解析文件路径（清洗非法字符）
- `deleteActionLog(conversationId)` — 删除文件（ENOENT 不抛异常）

### 5.17 资源缓存 —— `src/main/resourceCache.ts`

**职责：** 缓存 `fetch_url` 的结果到磁盘，支持分块存储和读取。

**核心设计：**
- **资源 ID：** `md5(source_url)` → 32 位十六进制字符串
- **存储位置：** `{userData}/resources/{resourceId}.json`
- **文件结构：** `CachedResourceFile { id, kind, source, chunks[], fetchedRanges[], status, ... }`
- **chunk 标识：** `chunk-{offset}-{endOffset}` —— 支持同一 URL 多个分页窗口

**`saveResourceChunk(resourceId, kind, source, title, totalChars, nextOffset, newChunk): SessionResource`**
- 读取现有文件（如存在）→ merge/upsert chunk → 重新计算 fetchedRanges 和 coverage 状态 → 写盘
- 返回给前端的 `SessionResource` **剥离了 chunk 中的 text 字段**（仅保留元数据），防止 IPC 传输巨大对象
- Chunk 总字符数超过 2MB 时按时间优先剪枝（优先淘汰旧 chunk）

**`readResourceChunk(resourceId, offset): string`**
- 先精确匹配 offset → 再范围覆盖匹配
- 返回 chunk 的原始 text

**`deleteResourceFile(resourceId)`**
- 自检 `RESOURCE_ID_PATTERN` (/^[a-f0-9]{32}$/) 防止路径注入
- ENOENT 不抛异常，其他错误仅 log —— best-effort 语义

**辅助函数：**
- `mergeRanges(ranges)` — 合并重叠/连续的读取范围
- `getFirstMissingOffset(ranges, totalChars)` — 找到第一个未覆盖的位置

### 5.18 Web 工具 —— `src/main/webTools.ts`

**职责：** 纯网络功能：URL 抓取、搜索引擎聚合、HTML 解析。无 Electron 依赖。

**安全机制：**

1. **DNS 解析检查：** `validatePublicHttpUrl()` → `lookup()` → 检查是否为私有 IP
   - 拦截 `localhost`、`127.0.0.1`、`10.x`、`172.16-31.x`、`192.168.x`、`fc00::/7`、`fe80::/10` 等
   - **防止 SSRF 攻击**

2. **重定向跟踪：** 最多 4 次，每次重定向后再次检查目标 IP

3. **响应大小限制：** 最大 800KB（`MAX_RESPONSE_BYTES`），超限截断

4. **请求超时：** 10 秒（`REQUEST_TIMEOUT_MS`）

**HTML 处理：**
- `stripHtml()` — 移除 script/style/svg/noscript 标签，解码 HTML 实体，规范化空白
- `extractLinks()` — 提取 `<a href>`，最多 40 个链接，过滤 `javascript:`/`#` 等

**搜索引擎级联：**

```
Web 搜索请求
  ├─ Bing (www.bing.com)         ← 首选，国际直达链接
  ├─ Sogou (www.sogou.com)       ← 中国可访问的备用
  └─ DuckDuckGo (html.duckduckgo.com) ← 最后备选（常被限速 202）
```

任何引擎返回 0 结果或异常 → 自动尝试下一个。全失败时抛出聚合错误。

**分页获取：**
- `normalizeFetchUrlOptions({offset, maxChars})` — 规范化分页参数
- `offset`（字符起始位置）+ `maxChars`（1000-16000）→ 返回窗口 + `nextOffset`
- 去重检测：相同 `(url, offset, maxChars)` 的窗口视为重复调用

### 5.19 Agent 模块入口 —— `src/main/agent/index.ts`

**职责：** Agent 子系统的对外接口，聚集 4 个函数。

```typescript
runAgentSkill(win, reqId, options, permissions)    // → runAgentLoop
runGeneralAgent(win, reqId, options, permissions)   // → runAgentLoop
resolveToolPermission(reqId, callId, approved)      // → globalPermissionManager.resolve
abortAgentSkill(reqId)                              // → abortRun
```

---

## 6. Preload 层详解

**文件：**
- `src/preload/index.ts` — 实现
- `src/preload/index.d.ts` — 类型声明（`Window.api` 接口扩展）

**设计：**
- 通过 `contextBridge.exposeInMainWorld` 暴露 `window.electron`（Electron API）和 `window.api`（自定义 API）
- 渲染进程只能访问预暴露的方法，无法访问 `ipcRenderer` 原生对象

**`window.api` 完整 API 列表：**

| 方法 | IPC 类型 | 用途 |
|------|----------|------|
| `storeGet(key)` | invoke | 读取持久化数据 |
| `storeSet(key, value)` | invoke | 写入持久化数据 |
| `getAppInfo()` | invoke | 获取存储路径和版本 |
| `hideWindow()` | send | 隐藏窗口 |
| `toggleDevTools()` | send | 开关 DevTools |
| `setFilePickerActive(active)` | send | 标记文件选择器状态 |
| `reSummonWindow()` | send | 重新显示窗口 |
| `startChatCompletion(reqId, options)` | send | 启动 Chat/Agent 对话 |
| `startAgentSkill(reqId, options)` | send | 启动 Agent Skill |
| `respondToolPermission(reqId, callId, approved)` | send | 响应用户权限选择 |
| `abortGeneration(reqId)` | send | 中止当前生成 |
| `clearSessionCaches(payload)` | invoke | 删除会话的磁盘缓存 |
| `onChatChunk(callback)` | on (subscribe) | 订阅 AI 输出流 |
| `fetchModels(url, apiKey)` | invoke | 获取可用模型列表 |

**`onChatChunk` 的实现：**
- 返回 `unsubscribe` 函数（调用 `ipcRenderer.removeListener`）
- 这是唯一使用 `ipcRenderer.on` 的方法 —— 所有流式数据通过此通道推送

---

## 7. Renderer Process 模块详解

### 7.1 App 根组件 —— `src/renderer/src/App.tsx`

**职责：** 所有状态和 Hook 的编排中心，UI 布局的顶层容器。约 850 行。

**Hook 编排：**
```
App
├─ useProviders()       → apiKey, apiUrl, model, systemPrompt, permissions, ...
├─ useSessions()        → sessions, activeSession, handleClearCurrentSession, ...
├─ useAttachments()     → attachedFiles, dragActive, handleFileChange, ...
├─ useChatCompletion()  → inputVal, isGenerating, handleSendMessage, ...
├─ useAutocomplete()    → autocompleteItems, selectedItemIdx, ...
└─ useSkills()          → skills, installSkill, removeSkill
```

**关键功能：**

1. **权限弹窗：** `getPendingPermission()` 扫描 activeSession 的消息找 `tool_call` 事件中 `permissionState === 'pending'` 的，渲染确认 UI。支持键盘操作（1/2/↑/↓/Enter/Esc）。

2. **自动补全触发：** `triggerAutocompleteItem()` 根据 `item.type` 分发：
   - `command` → new/clear/settings/help/exit
   - `delete-session` → handleDeleteSession
   - `session` → 切换活跃会话
   - `model` → 切换模型
   - `provider` → 切换服务商
   - `skill (agent)` → handleRunAgentSkill
   - `skill (prompt/send)` → 注入 prompt 或 handleSendMessage

3. **滚动管理：** 手动滚动时自动检测是否在底部，决定是否继续自动跟随

### 7.2 会话管理 Hook —— `src/renderer/src/hooks/useSessions.ts`

**职责：** 多会话 CRUD、活跃会话切换、5 分钟超时自动新建、缓存清理编排。

**导出：**

```typescript
useSessions(): {
  sessions, setSessions, sessionsRef,
  activeSessionId, setActiveSessionId, activeSession,
  handleNewSession, handleClearCurrentSession,
  handleDeleteSession, checkSessionTimeout
}

// 纯函数，导出供测试
computeOrphanResourceIds(target: Session, survivors: Session[]): string[]
```

**核心逻辑：**

**`checkSessionTimeout`：**
- 窗口显示时调用
- 如活跃会话的最后活跃时间 > 5 分钟前 → 自动新建会话
- ≤ 5 分钟 → 仅更新 `lastActiveTime`

**`handleClearCurrentSession`：**
1. 计算 `survivors = sessions.filter(id !== activeSessionId)`（**注意：清除后的会话自身不在 survivors 中**，因为它将被重置且不再引用任何资源）
2. `computeOrphanResourceIds(target, survivors)` 找到仅属于该会话的资源
3. `clearCachesFor(activeSessionId, orphans)` → IPC 删除磁盘文件
4. `storeSet` 更新 sessions（messages=[]，resources=[]，title='新对话'）

**`handleDeleteSession`：**
1. `survivors = sessions.filter(id !== targetSessionId)` — **在任何 placeholder 推入之前计算**
2. 计算孤儿资源 + `clearCachesFor`
3. 过滤出剩余会话，如目标为活跃会话则切换到第一个或新建

**`computeOrphanResourceIds` 的安全性：**
- 资源按 `md5(url)` 全局唯一，多会话可共享同一资源文件
- 孤儿检测确保仅在"目标会话引用且无其他会话引用"时才删除
- 处理 `resources` 为 `undefined` 的边界情况（兼容旧数据）

### 7.3 聊天补全 Hook —— `src/renderer/src/hooks/useChatCompletion.ts`

**职责：** 管理单次 AI 对话请求的生命周期，从发送到流式接收。

**核心函数 `startStreamingRun`：**
```
startStreamingRun(reqId, assistantMsgId, start, formatError)
  │
  ├─ window.api.onChatChunk((data) => {
  │   ├─ data.error      → updateMessage (formatError)
  │   ├─ data.done       → cleanup (unsubscribe, setIsGenerating(false), persist)
  │   ├─ data.content    → accumulate + updateMessageId
  │   ├─ data.reasoningContent → accumulate + updateMessageId
  │   ├─ data.event.type === 'resource_update' → merge session resources
  │   └─ data.event (other) → applyAgentEventToMessage
  │ })
  │
  └─ start()  // 触发 IPC 请求
```

**`applyAgentEventToMessage` 的合并策略：**
- `tool_call` 事件：按 `callId` 查重更新 `permissionState`
- `reasoning` / `final` 事件：连续的同类型事件合并 content（减少事件数组膨胀）
- 其他事件：直接 push

**`handleSendMessage`：**
1. 构造用户消息 → 追加到 currentSession
2. 创建空 assistantMsg 占位
3. 构建 `apiMessages[]`：支持多模态（图片 + 文本混合 content）
4. 调用 `startStreamingRun`
5. 传入 `sessionId: currentSession.id`（关键 —— 使 ActionLog 与会话绑定）

### 7.4 服务商 Hook —— `src/renderer/src/hooks/useProviders.ts`

**职责：** 多 AI 服务商（provider）配置管理，包括 API Key、URL、模型列表、系统提示词、权限策略的完整 CRUD。

**核心特性：**
- 从 store 加载/持久化 settings
- 服务商增删改 + 激活切换
- 模型列表的手动添加 / API 拉取（`fetchModels`）
- 工具权限的单个修改（`onChangeToolPermission`）

### 7.5 技能 Hook —— `src/renderer/src/hooks/useSkills.ts`

**职责：** Skill（技能）的安装和管理。

**`installSkillFromMarkdown(fileName, markdown)`：**
- 调用 `parseSkillMarkdown(markdown, fileName)` 解析 SKILL.md
- 生成唯一 ID、标准化字段（`triggers[]`、`kind`、`tools[]`、`rawMarkdown`）
- Agent 类型的 Skill 默认注入 `fetch_url` 工具

**规范化（`normalizeLoadedSkill`）：**
- 兼容旧格式：`trigger` → `triggers[]`
- 兼容旧格式：`mode === 'run'` → `kind = 'agent'`
- 确保 `rawMarkdown` 始终有值（回退到 `prompt`）

### 7.6 自动补全 Hook —— `src/renderer/src/hooks/useAutocomplete.ts`

**职责：** `/` 命令的自动补全逻辑。

**匹配类别：**
- 内置命令：`/new`、`/clear`、`/settings`、`/help`
- 模型切换：`/model:模型名`
- 会话切换：`/history:会话名` 或 `#会话名`
- 删除会话：`/delete:会话名`
- 服务商：`@服务商名`
- 技能：所有 installed skills 的 trigger

### 7.7 附件 Hook —— `src/renderer/src/hooks/useAttachments.ts`

**职责：** 文件上传管理（拖拽、粘贴、文件选择）。

**支持的类型：**
- 图片：转 base64 Data URL（用于多模态视觉模型）
- 文本文件：读取为文本引用
- 其他：读取为 base64 字符串引用

### 7.8 UI 组件

| 组件 | 文件 | 功能 |
|------|------|------|
| `MessageBubble` | `components/MessageBubble.tsx` | 单条消息渲染：Markdown、代码高亮、KaTeX 数学公式、Agent 事件流（推理/工具调用/结果）、权限状态徽章、编辑/重生成按钮 |
| `SettingsView` | `components/SettingsView.tsx` | 设置面板主容器：服务商列表、编辑器、全局设置、Skill 管理、权限配置 |
| `ModelsModal` | `components/ModelsModal.tsx` | 模型选择弹窗：勾选/取消模型 |
| `ProviderEditor` | `components/ProviderEditor.tsx` | 服务商编辑表单：名称、类型、API URL、Key、模型管理 |
| `ProviderList` | `components/ProviderList.tsx` | 服务商列表：切换激活、编辑、删除 |
| `SkillManager` | `components/SkillManager.tsx` | Skill 管理面板：安装（拖拽 SKILL.md）、查看、删除 |
| `FilePreviewList` | `components/FilePreviewList.tsx` | 附件预览列表：文件名、类型图标、删除按钮 |

---

## 8. Shared 类型系统

**文件：** `src/shared/types.ts`（约 250 行，零运行时代码）

**核心类型层次：**

```
消息层:
  Message → 前端 UI 消息（含 agentEvents）
  ChatCompletionMessage → API 格式消息（含 tool_calls）
  ToolArgs → Record<string, unknown>

会话层:
  Session { id, title, messages[], resources?[], lastActiveTime? }
  SessionResource { id(md5), kind, source, chunks[], fetchedRanges[], status }
  SessionResourceChunk { id, offset, endOffset, text?, summary? }

存储层:
  StorageSchema { sessions, settings, skills, memories }
  AppSettings { providers[], activeProviderId, systemPrompt, permissions, ... }
  ApiProvider { id, name, type, apiKey, apiUrl, model, modelsList }
  Skill { id, name, trigger, prompt, kind, tools[], maxSteps?, ... }

事件层:
  AgentEvent = agent_start | reasoning | tool_call | tool_result |
               tool_error | final | agent_progress | agent_end | resource_update
  ChatChunkData { reqId, content?, reasoningContent?, done?, error?, event? }

配置层:
  ChatRunOptions { apiUrl, apiKey, model, messages, runMode?, resources?, sessionId? }
  AgentSkillRunOptions extends ChatRunOptions + { skill, userInput }
  ClearSessionCachesPayload { sessionIds[], resourceIds[] }

工具定义层:
  ChatToolDeclaration { type: 'function', function: { name, description, parameters } }
  ToolResultUi { title?, url?, summary?, items? }

其他:
  AutocompleteItem → 自动补全候选项
  RunMode = 'chat' | 'agent'
```

---

## 9. IPC 通道总览

### invoke (Renderer → Main → 返回结果)

| 通道名 | 方向 | 参数 | 返回值 |
|--------|------|------|--------|
| `store-get` | renderer→main | `key: string` | `StorageSchema[K]` |
| `store-set` | renderer→main | `key, value` | `boolean` |
| `get-app-info` | renderer→main | 无 | `{ storePath, version }` |
| `clear-session-caches` | renderer→main | `{ sessionIds, resourceIds }` | `{ ok: true }` |
| `fetch-models` | renderer→main | `url, apiKey` | `string[]` |

### send (Renderer → Main，无返回值)

| 通道名 | 方向 | 参数 |
|--------|------|------|
| `hide-window` | renderer→main | 无 |
| `set-file-picker-active` | renderer→main | `active: boolean` |
| `re-summon-window` | renderer→main | 无 |
| `toggle-devtools` | renderer→main | 无 |
| `start-chat-completion` | renderer→main | `reqId, options: ChatRunOptions` |
| `start-agent-skill` | renderer→main | `reqId, options: AgentSkillRunOptions` |
| `respond-tool-permission` | renderer→main | `reqId, callId, approved` |
| `abort-generation` | renderer→main | `reqId` |

### send (Main → Renderer，事件推送)

| 通道名 | 方向 | 数据结构 |
|--------|------|----------|
| `chat-chunk` | main→renderer | `ChatChunkData { reqId, content?, reasoningContent?, done?, error?, event? }` |
| `window-shown` | main→renderer | 无参数 |

---

## 10. 缓存系统全景

QuickAI 有三层缓存，分别服务于不同目的：

```
┌─────────────────────────────────────────────────────────────┐
│                    缓存系统全景                               │
├──────────────┬──────────────┬──────────────┬────────────────┤
│   ActionLog  │ ResourceCache│ToolOutputStore│  FileStore    │
│   (行动日志)  │  (资源缓存)   │ (工具输出缓存) │  (应用存储)    │
├──────────────┼──────────────┼──────────────┼────────────────┤
│ 存储位置:     │ 存储位置:     │ 存储位置:      │ 存储位置:       │
│ userData/    │ userData/    │ 内存 Map       │ userData/      │
│ action_logs/ │ resources/   │ (Run 级生命周期)│ quickai_store  │
│ {id}.jsonl   │ {md5}.json   │                │ .json          │
├──────────────┼──────────────┼──────────────┼────────────────┤
│ 粒度:         │ 粒度:         │ 粒度:          │ 粒度:           │
│ per-session  │ per-URL      │ per-Run        │ 全局            │
│ (1:1)        │ (N:N 共享)    │ (临时)         │                │
├──────────────┼──────────────┼──────────────┼────────────────┤
│ 上限: 500条   │ 上限: 2MB     │ 上限: 5MB      │ 无上限          │
│ 淘汰: FIFO    │ 淘汰: 弃旧chunk│ 淘汰: FIFO     │ (全量读写)      │
├──────────────┼──────────────┼──────────────┼────────────────┤
│ 清理触发:     │ 清理触发:     │ 清理触发:      │ 清理触发:       │
│ /clear 时删   │ 孤儿检测后删  │ Run 结束销毁    │ /clear 时重置   │
│ /delete 时删  │ (renderer算  │                │ /delete 时移除  │
│              │  主进程删)    │                │                │
├──────────────┼──────────────┼──────────────┼────────────────┤
│ 敏感信息:     │ 不存敏感信息  │ 不存敏感信息    │ 可能含 API Key  │
│ 自动脱敏      │              │                │ (需加密，未实现) │
└──────────────┴──────────────┴──────────────┴────────────────┘
```

**缓存清理流程：**

```
/clear 或 /delete:{id}
  │
  ▼
Renderer: useSessions.ts
  │
  ├─ 计算 survivors (排除目标会话)
  ├─ computeOrphanResourceIds(target, survivors)
  │   └─ 纯函数：target.resources 中不被任何 survivor 引用的 id
  │
  ├─ window.api.clearSessionCaches({
  │     sessionIds: [targetSessionId],    // ActionLog 直接删
  │     resourceIds: [...orphans]         // Resource 仅删孤儿
  │   })
  │   ═══ IPC (invoke) ═══
  │
  ▼
Main: index.ts 'clear-session-caches' handler
  │
  ├─ 校验参数类型 (string[])
  ├─ Promise.allSettled:
  │   ├─ sessionIds.map(deleteActionLog)
  │   └─ resourceIds.map(deleteResourceFile)
  └─ 失败仅 log，永不抛
```

---

## 11. 安全模型

QuickAI 实现了多层纵深防御：

### 第一层：进程隔离
- Renderer 无法访问 Node.js API（sandbox）
- 所有原生操作通过 Preload 的有限 API 间接调用

### 第二层：文件系统安全（Workspace 沙箱）
- **根目录固定：** `~/quickai/`（不可配置变更）
- **路径越狱检测：** `isPathInWorkspace()` 和 `pathEscapesWorkspace()` 双重保障
  - 前者用 `fs.realpath` 解析符号链接
  - 后者做纯词法分析（无 fs 依赖，可在 guard 阶段快速过滤）
- **敏感文件保护：** `.env`、`id_rsa`、`.pem`、`.key`、`.cert` 等禁止读取
- **文件大小限制：** 读取 ≤2MB，写入 ≤2MB，搜索跳过 >512KB

### 第三层：网络安全（SSRF 防护）
- DNS 解析后检测私有 IP（IPv4 + IPv6）
- 拦截 localhost、内网地址
- 重定向后重新检测目标 IP
- 响应大小限制 800KB、超时 10s

### 第四层：工具权限策略
- **三级权限：** `allow`（静默执行）、`ask`（弹窗确认）、`deny`（完全禁止）
- **Constitution 守卫：** 参数级 escalate（路径逃逸→deny、敏感文件→ask、危险命令→deny）
- **默认安全的权限预设：**
  - 只读工具（fetch_url、file_read、搜索）→ allow
  - 写入工具（file_write）→ ask
  - shell → deny（始终禁止）

### 第五层：行为安全（LoopGuard）
- 相同调用 ≥3 次 → block
- 连续失败 ≥3 次 → warn
- 连续失败 ≥8 次 → halt

### 第六层：数据安全
- ActionLog 中的敏感参数自动脱敏（apiKey、token、password 等）
- Resource 缓存不存储敏感信息

---

## 12. 测试体系

**测试框架：** Vitest 4（`vitest run`）

**配置：**
- `include: ['src/**/*.{test,spec}.ts']`
- `environment: 'node'`
- `vi.mock('electron', ...)` 用于 mock Electron 模块

**现有测试：** 14 个测试文件，150 个测试用例

| 测试文件 | 测试内容 |
|----------|----------|
| `actionLog.test.ts` | 11 个测试：内存 CRUD、过滤、脱敏、FIFO 淘汰、持久化重载、跨会话隔离 |
| `agentLoop.test.ts` | Agent 循环的各种边界条件 + 回归测试 |
| `callModel.test.ts` | API 调用和 SSE 解析 |
| `commandSafety.test.ts` | 命令安全分析（dangerous/requires_approval/safe 分类） |
| `constitution.test.ts` | 守卫规则（路径越界、敏感文件、危险命令） |
| `contextManager.test.ts` | 上下文截断策略 |
| `loopGuard.test.ts` | 循环检测和熔断逻辑 |
| `messageBuilder.test.ts` | 提示词构建 |
| `tokenEstimator.test.ts` | Token 估算算法 |
| `toolOutputStore.test.ts` | 工具输出存储的 FIFO 淘汰 |
| `fileTools.test.ts` | 文件工具（read/write/search/list） |
| `webTools.test.ts` | Web 工具（fetchUrl/webSearch/HTML 解析） |
| `resourceCache.test.ts` | 资源缓存（CRUD/chunk merge/范围计算） |
| `useSessions.test.ts` | 6 个测试：`computeOrphanResourceIds` 孤儿检测纯函数 |

---

> 文档生成日期：2026-06-07
> 基于代码版本：main 分支 HEAD (7c43ed6 之后)
