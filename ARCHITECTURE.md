# QuickAI 技术架构文档

> 一个基于 Electron + React + TypeScript 的桌面 AI 助手应用，支持多服务商模型、分支与中断恢复的 ReAct Agent、持久化 SQLite 缓存和 Git 版本化的长期记忆系统。

---

## 目录

1. [项目概览与技术栈](#1-项目概览与技术栈)
2. [Electron 多进程与运行时环境](#2-electron-多进程与运行时环境)
3. [目录结构总览](#3-目录结构总览)
4. [持久化存储与数据库架构 (SQLite)](#4-持久化存储与数据库架构-sqlite)
5. [Git 长期记忆系统 (Durable Memory)](#5-git-长期记忆系统-durable-memory)
6. [模块化工具管理系统 (Dynamic Tools Registry)](#6-模块化工具管理系统-dynamic-tools-registry)
7. [分支与恢复的 Agent 执行引擎 (ReAct Loop)](#7-分支与恢复的-agent-执行引擎-react-loop)
8. [核心数据流与生命周期](#8-核心数据流与生命周期)
9. [Preload 桥接与安全模型](#9-preload-桥接与安全模型)
10. [Renderer 进程架构与 React Hooks 编排](#10-renderer-进程架构与-react-hooks-编排)
11. [IPC 通道设计与类型系统](#11-ipc-通道设计与类型系统)
12. [多层缓存体系](#12-多层缓存体系)
13. [系统安全模型与纵深防御](#13-系统安全模型与纵深防御)
14. [测试体系](#14-测试体系)

---

## 1. 项目概览与技术栈

QuickAI 是一个 **uTools 风格的桌面 AI 助手**，通过 `Alt+/` 全局快捷键在 Spotlight 风格的居中位置瞬间召唤/隐藏悬浮窗口。应用支持多种 AI 服务商（DeepSeek、Kimi/Moonshot、Ollama 本地部署等），并在底层构建了高度灵活的 ReAct 智能体（Agent）系统。

| 层级 | 技术 | 用途 |
| --- | --- | --- |
| **桌面容器** | Electron 39 | 窗口位置优化、系统托盘、全局快捷键、进程级隔离 |
| **构建工具** | electron-vite 5 | 统一 main/preload/renderer 三端的快速开发与打包 |
| **持久化层** | better-sqlite3 11 | 基于 SQLite 的关系型本地数据库，WAL 模式保障并发写入 |
| **长期记忆** | Git CLI + Markdown | 自动 Git 版本化的 Markdown 长期知识库 |
| **前端框架** | React 19 + TypeScript 5 | 渲染进程的响应式 UI 状态与事件响应 |
| **测试** | Vitest 4 | 支持 node 模拟及 Electron 环境 mock 的单元测试 |

---

## 2. Electron 多进程与运行时环境

应用采用 Electron 经典的多进程架构设计，将高风险的原生能力限制在主进程，渲染进程通过 Preload 层的沙箱接口进行隔离：

```
┌──────────────────────────────────────────────────────────┐
│                     Main Process (Node.js)               │
│                                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │   index.ts   │  │  database.ts  │  │  agentLoop.ts │  │
│  │  窗口与托盘  │  │ SQLite 持久化 │  │   ReAct 核心  │  │
│  └──────┬───────┘  └───────────────┘  └───────┬───────┘  │
│         │                                     │          │
│  ┌──────▼───────┐  ┌───────────────┐  ┌───────▼───────┐  │
│  │   store.ts   │  │ toolRegistry  │  │  memoryStore  │  │
│  │  KV 存储适配 │  │  动态工具注册 │  │  Git-Markdown │  │
│  └──────────────┘  └───────────────┘  └───────────────┘  │
│                                                          │
│  ═══════════════ IPC Bridge ═══════════════              │
│         contextBridge.exposeInMainWorld                   │
│└─────────────────────────┬────────────────────────────────┘
                           │
                           │  ipcRenderer.invoke / .send / .on
                           │
┌──────────────────────────▼───────────────────────────────┐
│                    Preload Layer (Sandbox)               │
│  index.ts — 暴露 window.api 与 window.electron 对象      │
└──────────────────────────┬───────────────────────────────┘
                           │
                           │  window.api.*
                           │
┌──────────────────────────▼───────────────────────────────┐
│                  Renderer Process (React)                │
│                                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │   App.tsx    │  │  chatStreaming│  │   components/ │  │
│  │ UI 布局与编排│  │ 前端流式解析器│  │  视图组件渲染 │  │
│  └──────┬───────┘  └───────────────┘  └───────┬───────┘  │
│         │                                                │
│  ┌──────▼───────┐  ┌───────────────┐  ┌───────────────┐  │
│  │  useSessions │  │ useAutocomplete│  │  useProviders │  │
│  │ 会话与分支管理│  │  命令自动补全  │  │ 服务商/API设置│  │
│  └──────────────┘  └───────────────┘  └───────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## 3. 目录结构总览

```
src/
├── shared/                       # 三端共享的纯类型定义与接口声明
│   └── types.ts                  # 全局类型定义（AI配置、消息、事件流、Skill、存储模型等）
├── preload/                      # 预加载脚本目录（沙箱桥接）
│   ├── index.ts                  # contextBridge API 暴露实现
│   └── index.d.ts                # window.api 接口类型声明
├── main/                         # Electron 主进程 (Node.js 运行时)
│   ├── index.ts                  # 应用入口：生命周期、托盘、窗口交互及 IPC 调度加载
│   ├── ipc/                      # 独立解耦的 IPC 注册模块目录
│   │   ├── mcpIpc.ts             # MCP 服务控制与注销 IPC 通道
│   │   ├── storeIpc.ts           # SQLite 配置适配与技能更新广播 IPC 通道
│   │   ├── memoryIpc.ts          # 长期记忆 Git 读写 IPC 通道
│   │   ├── cacheIpc.ts           # 会话分叉拷贝与孤立缓存清理 IPC 通道
│   │   ├── generationIpc.ts      # LLM 会话启动、技能执行与终止生成 IPC 通道
│   │   ├── windowIpc.ts          # 窗口控制（聚焦/最小化/置顶）与控制器注入通道
│   │   └── backgroundShellIpc.ts # 后台 shell 管理与通知 IPC 通道
│   ├── database/                 # SQLite 数据库模块目录
│   │   ├── connection.ts         # 数据库连接初始化与 PRAGMA 性能调优
│   │   ├── schema.ts             # 表结构 Schema 定义
│   │   ├── migration.ts          # 数据库迁移与 JSON 历史数据导入逻辑
│   │   └── *Store.ts             # 实体持久化 Repository (sessionStore, settingsStore, skillStore, projectStore, resourceStore)
│   ├── store.ts                  # 旧版 store 的适配层，透明桥接至 SQLite 数据库
│   ├── aiClient.ts               # Chat 模式入口，调用 LLM 完成标准会话
│   ├── paths.ts                  # 集中管理 ~/.quickai 等本地目录及路径解析
│   ├── resourceCache.ts          # 网络内容抓取的磁盘关系缓存管理
│   ├── logger.ts                 # 主进程文件和控制台日志记录器
│   ├── mcpManager.ts             # 负责连接和管理外部 MCP (Model Context Protocol) 服务的核心
│   ├── skillManager.ts           # 自定义技能包导入、模块运行管理
│   ├── web/                      # 网络服务提取层
│   │   ├── urlSafety.ts          # SSRF 安全防护与本地 IP 拦截
│   │   ├── htmlExtract.ts        # 网页 HTML 去冗余提取与 Markdown 转换
│   │   └── searchParsers.ts      # 多搜索引擎返回结果爬取解析
│   ├── memory/                   # Durable Memory 长期记忆模块
│   │   ├── memoryStore.ts        # memories/ 目录下 Markdown 文件的操作和自动索引
│   │   └── memoryGit.ts          # Git 自动跟踪提交与仓库初始化
│   ├── tools/                    # 模块化原子化工具箱目录
│   │   ├── types.ts              # 工具与执行上下文的 TypeScript 类型定义
│   │   ├── registry.ts           # 动态工具注册中心与 Bracket Proxy 代理
│   │   ├── helpers.ts            # SSRF检验、沙箱判断、系统通知等辅助组件
│   │   ├── file*Tool.ts          # 独立拆分的文件写/读/删除/重命名等原子工具
│   │   ├── web*Tool.ts           # 网页爬取、级联网络搜索等原子工具
│   │   ├── memory*Tool.ts        # 读、写、清理长期记忆的原子工具
│   │   ├── skill*Tool.ts         # 自定义技能创建、移除与安装的原子工具
│   │   └── ...                   # shellTool.ts, subagentTool.ts 等独立原子工具
│   └── agent/                    # Agent 引擎目录
│       ├── index.ts              # 引擎对外的统一导出入口
│       ├── AgentRunContext.ts    # Agent 运行时状态容器（工具临时大缓冲区等）
│       ├── agentLoop.ts          # Agent 顶层推理主循环
│       ├── messageBuilder.ts     # 系统提示词编排与上下文摘要拼接
│       ├── contextManager.ts     # 上下文窗口智能截断与裁剪管理器
│       ├── permissionManager.ts  # 等待前端异步审批的 Promise 等待逻辑
│       ├── constitution.ts       # 静态安全规则宪法，动态升降授权级别
│       ├── commandSafety.ts      # 词法分析的 Shell 命令与文件路径安全分类器
│       ├── loopGuard.ts          # 熔断守卫：防止 LLM 重复调用与报错陷入死循环
│       ├── *Runner.ts            # 单独解耦的任务驱动器 (modelTurnRunner, toolTurnRunner, toolBatchRunner, subagentRunner)
│       ├── toolStep*.ts          # 处理工具流的独立管道 (toolStepProcessor, toolStepApplicator, toolStepFinalizer, toolStepPresentation)
│       ├── cache*.ts             # 缓存诊断与状态提取 (cacheShapeDiagnostics, cachePriorityContext)
│       └── run*.ts               # checkpoint 切片还原与清单日志管理
└── renderer/                     # Renderer 进程 (React 前端)
    └── src/
        ├── main.tsx              # React 挂载入口
        ├── App.tsx               # UI 状态机骨架与全局弹窗管理
        ├── features/             # 内聚核心业务领域逻辑层
        │   └── chat/             # 聊天与生成核心逻辑层
        │       ├── apiMessageBuilder.ts       # API 消息组装与 /compact 上下文剪枝
        │       ├── sessionMutationService.ts  # 新会话首发回写与 fork 逻辑事务
        │       ├── chatCompletionPure.test.ts # 对话调度核心纯函数的单元测试集
        │       └── useAgentMessageViewModel.ts # 单条消息呈现状态与计时的 ViewModel 钩子
        ├── hooks/                # 响应式逻辑 Hook
        │   ├── useSessions.ts    # 会话列表增删改查及缓存自动修剪
        │   ├── useChatCompletion.ts # 对话调度 React 绑定驱动层，承接业务流推进
        │   ├── useProviders.ts   # 多模型、服务商及工具权限配置管理
        │   ├── useSkills.ts      # Skill 的 markdown 导入与解析
        │   ├── useAutocomplete.ts # Spotlight 式快捷指令自动完成
        │   ├── useAttachments.ts # 前端粘贴/拖拽附件预处理
        │   ├── chatStreaming.ts  # 处理与 Preload `onChatChunk` 通信的前端逻辑封装
        │   ├── sessionBranching.ts # 创建分叉会话、提取运行轨迹等分支工具包
        │   └── chatMessageEvents.ts # 辅助消息渲染与行内恢复逻辑转换
        ├── components/           # UI 视图组件
        │   ├── MessageBubble.tsx # 单条消息气泡，消费 useAgentMessageViewModel 产出的稳定呈现状态
        │   ├── SettingsView.tsx  # 设置面板（服务商、模型选择、技能导入、权限审计）
        │   └── ...
        └── utils/
            ├── messageFormat.tsx # Markdown + KaTeX + Prism 代码高亮渲染器
            └── skillMarkdown.ts  # SKILL.md 声明格式解析器
```

---

## 4. 持久化存储与数据库架构 (SQLite)

在之前的版本中，QuickAI 使用 JSON 文件进行扁平化存储。现已全面重构成基于本地 SQLite 关系型数据库的模块化架构。

### 4.1 模块化数据库架构 —— [src/main/database/](file:///d:/Git/Quick%20Ai/src/main/database)

数据库逻辑不再堆叠在单文件中，而是采用 Repository 模式解耦为以下子模块：

*   **连接配置管理器 —— [connection.ts](file:///d:/Git/Quick%20Ai/src/main/database/connection.ts)**：
    负责数据库首次初始化，定位 `{userData}/quickai.db` 文件，并应用高性能 SQLite Pragma 优化：
    *   `journal_mode = WAL`：开启 Write-Ahead Logging 模式，提供高并发读写性能。
    *   `foreign_keys = ON`：强制启用外键物理约束。
    *   `synchronous = NORMAL`：在安全与磁盘 I/O 间取得平衡。
*   **结构定义与表定义 —— [schema.ts](file:///d:/Git/Quick%20Ai/src/main/database/schema.ts)**：
    定义关系数据库各张表的 DDL。
*   **数据迁移与导入引擎 —— [migration.ts](file:///d:/Git/Quick%20Ai/src/main/database/migration.ts)**：
    处理版本迭代时的表结构平滑迁移，以及 `migrateFromJson()`（在数据库为空时读取旧的 `quickai_store.json` 进行一次性原子导入，并生成 `.bak` 备份）。
*   **业务逻辑持久化仓库 (Repositories)**：
    *   [settingsStore.ts](file:///d:/Git/Quick%20Ai/src/main/database/settingsStore.ts)：全局 KV 配置与服务商凭证存储。
    *   [sessionStore.ts](file:///d:/Git/Quick%20Ai/src/main/database/sessionStore.ts)：会话及其下层级联消息（Messages & Files）的管理仓库。
    *   [skillStore.ts](file:///d:/Git/Quick%20Ai/src/main/database/skillStore.ts)：AI 技能包元数据和资源路径存储。
    *   [projectStore.ts](file:///d:/Git/Quick%20Ai/src/main/database/projectStore.ts)：多工作空间项目属性持久化。
    *   [resourceStore.ts](file:///d:/Git/Quick%20Ai/src/main/database/resourceStore.ts)：网页抓取及 PDF 读入的切片级缓存管理器。

### 4.2 数据库 Schema 结构

```mermaid
erDiagram
    settings {
        text key PK
        text value
    }
    providers {
        text id PK
        text name
        text type
        text apiKey
        text apiUrl
        text model
        text modelsList
    }
    sessions {
        text id PK
        text title
        integer lastActiveTime
        text branchOf
    }
    messages {
        text id PK
        text sessionId FK
        text role
        text content
        text reasoning_content
        text agentRunId
        text agentRunIds
        text agentEvents
        text forkedFrom
        integer isBranchFork
        integer createdAt
    }
    message_files {
        integer id PK
        text messageId FK
        text name
        text content
        text type
    }
    skills {
        text id PK
        text name
        text trigger
        text prompt
        text description
        text triggers
        text mode
        text kind
        text tools
        integer maxSteps
        text rawMarkdown
        text source
        text entryPath
        text packageRoot
        text packageFiles
        integer installedAt
        integer updatedAt
        text toolDiscovery
    }
    resource_cache {
        text id PK
        text kind
        text source
        text title
        text fingerprint
        integer totalChars
        text fetchedRanges
        integer nextOffset
        text status
        text summary
        integer createdAt
        integer updatedAt
    }
    resource_chunks {
        text id PK
        text resourceId FK
        integer offset
        integer endOffset
        integer page
        text section
        text text
        text summary
        integer createdAt
    }
    
    sessions ||--o{ messages : "has"
    messages ||--o{ message_files : "contains"
    resource_cache ||--o{ resource_chunks : "has"
```

### 4.3 JSON 数据自动迁移机制

如果数据库为空而本地存在旧格式的 `quickai_store.json` 与 `resources/` 目录，[migration.ts](file:///d:/Git/Quick%20Ai/src/main/database/migration.ts) 中的 `migrateFromJson()` 会自动解析旧数据，通过批量准备语句 (Prepared Statements) 将数据转换并插入到 SQLite 对应的表中，成功后将旧的 JSON 文件重命名为 `.bak` 文件。

### 4.4 KV 桥接适配器 —— [store.ts](file:///d:/Git/Quick%20Ai/src/main/store.ts)

为了不破坏已有的 IPC 调用逻辑，[store.ts](file:///d:/Git/Quick%20Ai/src/main/store.ts) 导出了一个 `FileStore` 类，其 `get(key)` 和 `set(key, val)` 接口保持原样，但在内部透明地转换为调用 `database` 各仓库中的 `loadSettings()`, `saveSettings()`, `loadSessions()`, `saveSessions()`, `loadSkills()`, `saveSkills()` 等关系型数据库读写逻辑。

---

## 5. Git 长期记忆系统 (Durable Memory)

为了防止模型会话因为上下文截断而丧失对全局背景、工作路径或用户核心偏好的认知，应用设计了独立于会话上下文的长期记忆系统。

### 5.1 记忆目录结构 (`~/.quickai/memories`)
长期记忆库由以下核心 Markdown 文件组成，由主进程的 [memoryStore.ts](file:///d:/Git/Quick%20Ai/src/main/memory/memoryStore.ts) 进行维护：

- `always.md` (常态注入内存)：每一轮任务都会强制拉取并拼接在系统提示词的最上方，适合记录全局安全边界、用户语言偏好。
- `memory_summary.md` (按需索引表)：保存由 MEMORY.md 的所有 `Task Group` 提取的条目目录。在任务初始化时会被注入到 System Prompt，告诉模型当前有哪些大记忆组可以调用。
- `MEMORY.md` (按需知识库)：按照 `# Task Group: <名称>` 进行段落划分的本地 Markdown 知识库。模型可以通过 `read_memory(target="xxx")` 按需提取。
- `raw_memories.md` (原始记忆沉淀)：追加写入的原始经验记录，供系统重建或审计。
- `rollout_summaries/` (任务轨迹追溯)：记录历史任务执行成功或失败的溯源日志（以日期-命名命名）。

### 5.2 自动 Git 版本化控制 —— [memoryGit.ts](file:///d:/Git/Quick%20Ai/src/main/memory/memoryGit.ts)

每次模型通过 `write_memory` 或 `delete_memory` 修改上述 Markdown 文件时，[memoryStore.ts](file:///d:/Git/Quick%20Ai/src/main/memory/memoryStore.ts) 会在写入完成后立即执行 Git 命令：
1. 检查本地 `.git` 目录是否存在。如果不存在则执行 `git init` 自动初始化仓库，并预置本地提交邮箱为 `memory@quickai.local`。
2. 调用 `git add -A` 暂存所有变化。
3. 调用 `git commit -m "memory: write task group ..."` 固化记录，确保每一次记忆改动都可查、可做差异分析 (Diff)、可做历史回滚。
4. **容错机制**：由于 Git 依赖于系统命令，如果用户机器未安装 Git 命令行工具，底层会自动退避为“无版本控制”的纯文件读写，保证记忆功能依旧可用。

---

## 6. 模块化工具管理系统 (Dynamic Tools Registry)

随着工具量级的提升，QuickAI 从早期单文件的硬编码注册升级为模块化、动态可插拔的工具设计。

### 6.1 工具定义规范 —— [types.ts](file:///d:/Git/Quick%20Ai/src/main/tools/types.ts)

每个工具都必须实现 `ToolDefinition` 接口：
```typescript
export interface ToolDefinition {
  name: string
  title: string
  description: string
  tags: string[]
  category: 'web' | 'file' | 'shell' | 'memory' | 'system'
  risk: 'low' | 'medium' | 'high'
  implemented: boolean
  discoverable: boolean
  parameters: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
  execute: (args: ToolArgs, ctx: ToolExecutionContext) => Promise<{
    resultForModel: string
    resultForUi: ToolResultUi
  }>
}
```

### 6.2 动态工具注册中心 —— [registry.ts](file:///d:/Git/Quick%20Ai/src/main/tools/registry.ts)

工具不再集中于几个粗粒度的类别大文件中，而是被彻底原子化拆分为存放于 `src/main/tools/` 目录下的独立专责文件（如 `fileReadTool.ts`、`webSearchTool.ts`、`subagentTool.ts` 等），遵循单一职责原则。

#### 核心工具模块划分：
*   **文件操作工具（File Tools）**：
    *   `fileReadTool.ts` / `fileWriteTool.ts` / `fileEditTool.ts` / `fileDeleteTool.ts`：读写删改。
    *   `fileCopyTool.ts` / `fileMoveTool.ts` / `directoryCreateTool.ts`：复制、移动和目录创建。
    *   `workspaceListFilesTool.ts` / `workspaceSearchTool.ts` / `workspaceGlob.ts`：工作空间文件列举、正则和 Glob 检索。
*   **网络操作工具（Web Tools）**：
    *   `webFetchTool.ts` / `webSearchTool.ts`：网页抓取和网络搜索引擎接口调用。
*   **系统与通知工具（System Tools）**：
    *   `notifyTool.ts` / `inspectEnvironmentTool.ts` / `environmentProbe.ts`：通知系统与本地运行时环境检测。
    *   `taskTool.ts`：用于 Agent 追踪计划分解的步骤记录。
*   **长期记忆管理工具（Memory Tools）**：
    *   `memoryReadTools.ts` / `memoryWriteTools.ts` / `memoryActionTools.ts`：长期知识库与行动历史记录的管理。
*   **子 Agent 与运行时（Subagent & Core Tools）**：
    *   `subagentTool.ts`：派生独立沙箱子 Agent 的接口。
    *   `toolOutputTools.ts` / `cachedResourceTools.ts`：大容量工具输出和资源抓取缓存检索。
*   **技能生命周期管理（Skill Tools）**：
    *   `skillCreateTool.ts` / `skillInstallTool.ts` / `skillRemoveTool.ts` / `skillListTool.ts`：自定义技能包的热插拔管理。

主进程启动时会利用 `ToolRegistryImpl` 注册所有内置模块。为了兼容旧版代码直接使用 `ToolRegistry[name]` 的属性语法访问，[registry.ts](file:///d:/Git/Quick%20Ai/src/main/tools/registry.ts) 暴露了一个 Proxy 代理。当调用 `ToolRegistry[name]` 时，代理会将调用路由至 `ToolRegistryImpl.get(name)`。同时，它配合 [registryView.ts](file:///d:/Git/Quick%20Ai/src/main/tools/registryView.ts) 支持对动态加载的工具进行元数据审查与迭代。

### 6.3 MCP 连接与执行超时机制强化

为了防御不稳定的外部 MCP 服务可能导致的子进程或连接悬挂风险，`McpManager` 引入了细粒度的超时保护与主动销毁逻辑：

- **读取全局 `timeouts` 调度配置**：在主进程 reload 时读取配置文件的顶层 `timeouts` 声明，包含 `connect_timeout` (连接与工具声明检索超时) 和 `execute_timeout` (单个工具执行超时)。
- **双向连接与列表请求超时熔断**：应用将 `client.connect` 和 `client.listTools` 统一包裹在 `withTimeout` 竞速中（默认为 10s）。一旦发生超时或网络无法连通，将触发该 Server 的彻底注销。
- **运行期间的 CallTool 超时熔断**：调用 `client.callTool` 时应用会对其添加 `execute_timeout` 的上限判定（默认为 30s）。若工具执行卡死超时，将立刻抛出超时异常反馈给大模型，确保管线不被阻塞。
- **靶向 Server 关闭与卸载机制 (`cleanupServer`)**：在任何阶段（包括连接与工具运行）检测到超时后，McpManager 会独立针对故障 Server 执行清理事务：
  1. 调用 `client.close()` / `transport.close()` 触发底层的 stdio 连接切断并退出相应的 child process 句柄。
  2. 从 `registeredToolNames` 内存集中识别并批量注销该 Server 下注册在 QuickAI Registry 中的所有 `mcp_{server}_{tool}` 工具。
  3. 将该 MCP 服务在 UI 的状态字典中设置为 `failed`，并附带确切的 timeout 报错信息，保障悬挂进程和僵死工具被及时清理。

---

## 7. 分支与恢复的 Agent 执行引擎 (ReAct Loop)

Agent 执行引擎基于 ReAct 循环，解耦为了高度模块化的管线处理器（Pipeline Processors），以提供对会话中断（Interrupt）、切片保存（Checkpointing）、分支（Branching）和状态复苏（Resuming）的完整支持。

### 7.1 Agent 执行管线拆解与生命周期

当 Agent 被触发时，它将依次流经以下由 [src/main/agent/](file:///d:/Git/Quick%20Ai/src/main/agent) 驱动的处理阶段：

1.  **准备阶段（Run Preparation）**：
    由 `agentRunPreparation.ts` 对最大步数上限等入参进行校验和修剪，并使用 `runUsageTracker.ts` 开启本次运行的 Token 及调用计数统计。
2.  **大模型思考规划驱动（Model Turn Runner）**：
    由 `modelTurnRunner.ts` 发起流式 LLM 调用。它根据服务商类型智能路由给 `callChatCompletionsModel.ts` 或 `callResponsesModel.ts`，由流式解析器实时输出 `<think>` 思考内容与工具调用规划（Tool Calls）。
3.  **安全审查与授权（Permission Guard）**：
    提取规划中的工具参数，交由 `constitution.ts` 和 `commandSafety.ts` 进行路径逃逸和高危 Shell 命令分析，必要时通过 `permissionManager.ts` 抛出 IPC 挂起 Promise，等待前端操作审批。
4.  **工具批量执行器（Tool Turn Runner）**：
    由 `toolTurnRunner.ts` 进行工具调度。当有多项无依赖的工具调用时，由 `toolBatchRunner.ts` 开启并发执行，通过 `preparedToolExecutor.ts` 分发具体的本地原子工具（`*Tool.ts`）并回收结果。
5.  **步骤落地与清洗管道（Step Processor & Applicator）**：
    *   `toolStepProcessor.ts`：将执行结果与原始调用请求封装为完整的步骤块。
    *   `toolStepApplicator.ts`：处理可能发生的文件系统与变量状态变更应用。
    *   `toolStepFinalizer.ts`：执行步骤的最终结算，并进行 `persistCheckpoint` 数据落盘。
    *   `toolStepPresentation.ts`：实时将最终步骤的视觉化结果推送回 React 渲染进程进行展示。

### 7.2 Agent 切片与清单体系

在管线执行的每个 Turn 结束时，引擎会持久化保存以下两套关键数据，以支持分支切换和崩溃恢复：

#### 1. 运行时切片 —— [runCheckpoint.ts](file:///d:/Git/Quick%20Ai/src/main/agent/runCheckpoint.ts)
切片保存了单步执行完毕时的全部关键状态，写入到磁盘：`{userData}/run_checkpoints/{sessionId}/{reqId}.json`。
```typescript
export interface RunCheckpoint {
  version: number
  sessionId: string     // 关联会话ID
  reqId: string         // 关联运行ID
  updatedAt: number
  step: number          // 当前执行的步数
  messages: ChatCompletionMessage[] // 当前全量历史消息
  activeTools: string[] // 当前已发现激活的工具
  lastCompletedCallId?: string
  ambiguousActions?: AmbiguousAction[] // 存留的执行状态模糊的动作
}
```

#### 2. 执行清单 —— [runManifest.ts](file:///d:/Git/Quick%20Ai/src/main/agent/runManifest.ts)
清单记录了一个运行过程中的追踪信息，存盘路径为 `{userData}/run_manifests/{sessionId}/{reqId}.json`：
```typescript
export interface AgentRunManifest {
  version: number
  runId: string
  sessionId: string
  sourceMessageId?: string      // 触发该 Run 的 User 消息 ID
  assistantMessageId?: string   // 本次 Run 写入的 Assistant 消息 ID
  parentRunId?: string          // 如果是 Resume，父级 Run 的 ID
  branchOf?: { sessionId: string; messageId: string; runId?: string } // 分支来源
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'max_steps'
  actionCallIds: string[]       // 调用过的所有 action id 列表
  resourceIds: string[]         // 涉及的全部 fetched 网页缓存ID
  sideEffects: SideEffectEntry[] // 发生的副作用列表（如文件写入、shell执行）
}
```

### 7.3 中断与在线恢复机制 (Resume Mode)

当 Agent 由于异常（网络瞬断、大模型限流、或用户手动取消）中断时，UI 气泡会渲染 **“恢复（Resume）”** 按钮。
1. 用户点击恢复后，前端携带该步骤的 `agentRunId` 发送 `start-chat-completion` 请求。
2. 主进程拦截恢复信号，由 `agentLoop.ts` 重新加载对应 Run 缓存的 `RunCheckpoint` 切片，将执行状态精确恢复至中断步数。
3. 大模型重新开始前，主进程在上下文末尾追加由 `resumePrompts.ts` 生成的 `RESUME MODE` 系统提示词，指出这是一次非破坏性的状态恢复，以引导 LLM 衔接先前的观察结果继续任务。

### 7.4 会话分支派生与重构 (Session Branching)

当用户在历史旧消息上点击编辑或重新生成时，系统会触发分支分叉：
1. **状态复制与分叉**：
   渲染进程利用 [sessionBranching.ts](file:///d:/Git/Quick%20Ai/src/renderer/src/hooks/sessionBranching.ts) 创建带有 `branchOf` 标志的全新 Session，克隆当前时间戳前的所有历史消息，并将编辑后内容作为最新的 User 消息。
2. **持久化缓存分叉 (Fork Caches)**：
   主进程接收 `fork-session-caches` 请求，将父 Session 中该时间节点前所有的 `RunCheckpoint` 切片文件及行动日志（`actionLog`）成套克隆至新 Session 目录。分支 Session 将无缝继承先前的运行历史，使模型在检索过去操作时免受重复请求与执行的困扰。

---

## 8. 核心数据流与生命周期

以下是用户触发 Agent 或常规 Chat 到流式输出完毕的典型链路图：

```
                    Renderer 进程                           Main 进程
                      
用户点击发送 ───────────────────────────────┐
  │                                         │
  ▼                                         │
App.tsx: handleSendMessage()                │
  │                                         │
  ├─ 检查运行模式 (RunMode: chat/agent)        │
  ├─ [分支模式检测] ─ 触发?                   │
  │     └─ YES: 创建新 Session (branchOf)    │
  │             调用 forkSessionCaches()  ──┼──────────────────┐
  │             切换活跃会话为新分支        │                  │
  ├─ 渲染 User 消息及 Assistant 占位气泡       │                  │
  └─ 调用 window.api.startChatCompletion() ─┼────────┐         │
                                            │        │         │
                                            │        ▼         │
                                            │  index.ts        │
                                            │    │             │
                                            │    ├─ fork 逻辑 ─┼─── 复制 checkpoints
                                            │    │             │    及行动日志
                                            │    ▼             │
                                            │  agentLoop.ts    │
                                            │    │             │
                                            │    ├─ loadCheckpoint (如果是 Resume)
                                            │    ├─ 评估静态+动态权限
                                            │    ├─ 离线 Trim 消息适配 Context size
                                            │    │             │
                                            │    ▼             │
                                            │  [ReAct 循环] ◄──┐
                                            │    │             │
                                            │    ├─ callModel() (流式解析 SSE + <think>)
                                            │    │  ├─ reasoning ──► 抛出 chat-chunk
                                            │    │  └─ final ──────► 抛出 chat-chunk
                                            │    │             │
                                            │    ├─ prepareToolCalls()
                                            │    │  ├─ blocked ───► 直接返回报错/死锁
                                            │    │  ├─ direct ────► 并发执行
                                            │    │  └─ ask ───────► 阻断, 发送权限请求 ──┐
                                            │    │                                      │
                                            │    ├─ persistCheckpoint()                 │
                                            │    └─ 检查熔断或 maxSteps -> 结束          │
                                            │                                           │
                                            │◄──────────────────────────────────────────┘
  ┌─ 渲染 reasoning 实时思考段落               │ (主进程 Promise 等待 UI 响应)
  ├─ 渲染 final 流式输出内容                   │
  └─ [收到 tool_call 等待授权事件]            │
       │                                    │
       ▼                                    │
App.tsx: 弹出权限操作抽屉                     │
       │                                    │
       ├─ 用户点击“允许/拒绝”                 │
       └─ window.api.respondToolPermission()─┼───────► resolve() 挂起的 Promise
                                                       │
                                                       ▼
                                                     恢复工具执行，进入下一步
```

---

## 9. Preload 桥接与安全模型

Preload 层 ([index.ts](file:///d:/Git/Quick%20Ai/src/preload/index.ts)) 在保持严格沙箱特性的前提下，暴露出有限的系统级操作权限。

### 9.1 全局暴露接口

`window.api` 暴露的方法清单及其实际功能：
- `storeGet(key)` / `storeSet(key, value)`：进行 KV 格式配置、会话信息的存储交互。使用白名单过滤，只允许写入 `sessions`、`settings`、`skills` 键值。
- `getAppInfo()`：获取持久化数据库文件物理路径和当前应用版本号。
- `hideWindow()` / `reSummonWindow()`：控制窗口的折叠和唤醒。
- `setFilePickerActive(active)`：文件对话框打开时屏蔽 blur 自动隐藏。
- `setWindowPinned(pinned)`：窗口置顶/取消置顶控制。
- `startChatCompletion(reqId, options)`：向主进程发出会话请求。
- `startAgentSkill(reqId, options)`：以 Skill 模块注入系统提示词的形式触发 Agent 请求。
- `respondToolPermission(reqId, callId, approved)`：将权限确认的结果反馈给等待中的 Promise 授权机制。
- `abortGeneration(reqId)`：中止特定请求。
- `clearSessionCaches(payload)`：批量清理特定会话的 action log、切片文件以及无其他会话引用的“孤儿”网页缓存。
- `forkSessionCaches(payload)`：复制特定 Runs 历史的执行缓存到分支会话。
- `onChatChunk(callback)`：流式通道订阅。返回一个 `unsubscribe` 清理函数。
- `showNotification(title, body)`：触发系统通知。
- `listMemoryEntries()` / `readMemoryEntry(id)` / `writeMemoryEntry(id, content)`：提供给前端记忆管理面板读写长期记忆 Markdown 的底层支持。

---

## 10. Renderer 进程架构与 React Hooks 编排

前端完全基于 React 函数式组件及模块化 Hooks 架构构建，将页面状态编排和副作用逻辑进行了清晰的分离。

### 10.1 顶层状态调度中心 —— [App.tsx](file:///d:/Git/Quick%20Ai/src/renderer/src/App.tsx)

`App.tsx` 整合了五大领域 Hooks 导出的业务状态和事件处理器：

```
                      App.tsx
                         │
        ┌──────────┬─────┴────┬──────────┐
        │          │          │          │
        ▼          ▼          ▼          ▼
   useProviders useSessions useSkills useAttachments
        │          │          │          │
        └──────────┼──────────┼──────────┘
                   ▼
           useChatCompletion
```

### 10.2 领域 Hooks 设计

- [useProviders.ts](file:///d:/Git/Quick%20Ai/src/renderer/src/hooks/useProviders.ts) (服务商管理)：
  - 绑定 SQLite 中 `settings` 表的数据，控制全局 API url、Key 的维护。
  - 获取各服务商下的模型列表，控制工具的全局开关及默认静态权限（allow/ask/deny）。
  
- [useSessions.ts](file:///d:/Git/Quick%20Ai/src/renderer/src/hooks/useSessions.ts) (多会话维护)：
  - 管理左侧会话历史的 CRUD。
  - 维护 5 分钟超时机制：当窗口重新聚焦且活跃会话的最后一次活动时间超出 5 分钟，会自动创建一个新的“新对话”会话，防止会话上下文过长降低效率。
  - **孤儿资源修剪**：当删除某会话或执行 clear 时，该 Hook 导出的 `computeResourcePrune()` 会在前端计算出**仅由当前被清理会话引用，而未被其他存活会话引用**的所有 `resourceId` 列表，然后发送 `clearSessionCaches` 彻底移出磁盘。

- [useChatCompletion.ts](file:///d:/Git/Quick%20Ai/src/renderer/src/hooks/useChatCompletion.ts) (生成流调度)：
  - 对话流调度的 React 驱动器与通道绑定层。
  - 承载正常发送、技能启动、单条消息中途编辑分叉、单步故障恢复的流式监听器。

- [useAutocomplete.ts](file:///d:/Git/Quick%20Ai/src/renderer/src/hooks/useAutocomplete.ts) (补全系统)：
  - 监控输入框字符，如果以 `/`、`#`、`@` 开头，会检索内置命令、会话、服务商和技能别名，返回高可用的补全面板列表。

### 10.3 核心生成逻辑解耦与 ViewModel 模式 (MVVM)

随着业务的复杂化（分支、中途编辑、多路会话状态回写、Agent 多路事件解析），Renderer 进程引入了 MVVM 风格的领域模型解耦方案：

#### 1. 聊天生成内核解耦 (Chat Completion Core Domain)
原先积压在 React Hooks 内部的纯逻辑和复杂的数据回刷事务被彻底解耦至 `src/renderer/src/features/chat/`，以纯 TypeScript 服务形式呈现：
- **`apiMessageBuilder.ts`**：构造发送 payload。自动前置调用 `getMessagesForLLM(messages)`，过滤多余上下文并遵守最近一次 `/compact` 的历史裁减，保证压缩会话边界被完全保护，同时计算出准确的上下文偏移量。
- **`sessionMutationService.ts`**：管理多级会话流回填。对于新草稿会话首发，该模块自动回填并用 `updatedSessions` 覆盖全局会话树实例；在单条消息中途编辑分叉时，智能执行 Fork 或覆盖编辑（当处于历史最末端时执行原地覆盖，当处于历史中间时默认触发 Fork 分支）。
- **`chatCompletionPure.test.ts`**：对上述解耦的对话调度核心函数（例如 `resolveSessionForSend` 等）提供完备的纯函数单元测试。

#### 2. MessageBubble 视图与逻辑分离 (ViewModel Pattern)
- **`useAgentMessageViewModel.ts`**：为 MessageBubble 视图提供干净、无副作用的数据绑定接口。
  - **计时机制**：内部自带以 500ms 刷新频率刷新耗时统计的 Timer。
  - **统一解析**：接收 `agentEvents` 并处理结构化时间线 (Structured Timeline Step Mode)，或者兼容旧的 `[tool ...]` 日志提取，向外输出归一化的 `agentStatus` (running / completed / failed / cancelled 等) 和 `cockpitColor` 主题基调。
  - **剪切板封装**：直接封装 `handleCopy` 复制逻辑，完成对 `/think` 标记剥离和脱敏后的消息文本提取。
  - **UI 瘦身**：[MessageBubble.tsx](file:///d:/Git/Quick%20Ai/src/renderer/src/components/MessageBubble.tsx) 只需消费 ViewModel 输送的稳定属性，无需维护多个 `useState`、`useMemo` 及 `useEffect` 计算，保持 React DOM 及 UI 逻辑的高内聚低耦合。

---

## 11. IPC 通道设计与类型系统

应用通过严格的 TypeScript 契约统一约束前端和主进程之间的交互参数。所有的接口实体均放置在 [types.ts](file:///d:/Git/Quick%20Ai/src/shared/types.ts) 共享模块下。

主进程中的 IPC 通道注册已从 `index.ts` 彻底解耦，按业务领域聚合至 `src/main/ipc/` 目录下独立注册，避免反向依赖和主进程文件体积膨胀：
- **`mcpIpc.ts`**：对接 `McpManager` 读写/注销 MCP 服务。
- **`storeIpc.ts`**：控制基础 KV 设置与技能库更新广播。
- **`memoryIpc.ts`**：对接长期记忆 Git Markdown 仓库的同步读写。
- **`cacheIpc.ts`**：驱动会话清理、资源 Orphan 判定及缓存 Fork。
- **`generationIpc.ts`**：对接 Agent 思考与生成控制，并在 UI 侧文件选择器激活时阻止窗口 blur 隐藏。
- **`windowIpc.ts`**：控制窗口置顶、DEV 工具开启及通知分发，通过 Controller 回调注入窗口状态，解耦具体状态变量。
- **`backgroundShellIpc.ts`**：后台进程任务挂载与终止。

### 11.1 IPC 接口全景表

| 模式 | 通道名称 | 传参 | 返回值 | 职责描述 |
| --- | --- | --- | --- | --- |
| **Invoke** | `store-get` | `key: StoreKey` | `StoreValue` | 读取 store 允许白名单内的配置数据 |
| **Invoke** | `store-set` | `key, value` | `boolean` | 写入 store 允许配置 |
| **Invoke** | `get-app-info` | 无 | `{ storePath, version }` | 返回物理存储路径 |
| **Invoke** | `clear-session-caches` | `ClearSessionCachesPayload` | `{ ok: true }` | 物理清除磁盘日志及孤立缓存 |
| **Invoke** | `fork-session-caches` | `ForkSessionCachesPayload` | `{ ok, actions... }` | 分叉会话时拷贝之前的运行缓存 |
| **Invoke** | `fetch-models` | `apiUrl, apiKey` | `string[]` | 动态连网请求服务商模型列表 |
| **Invoke** | `memory-entries` | 无 | `MemoryEntry[]` | 返回全部长期记忆文件描述 |
| **Invoke** | `memory-entry-read` | `id: string` | `string` | 读特定长期记忆内容 |
| **Invoke** | `memory-entry-write`| `id, content` | `{ ok: true }` | 更新特定长期记忆文件内容并执行 Git 提交 |
| **Send** | `hide-window` | 无 | 无 | 隐藏悬浮框 |
| **Send** | `set-file-picker-active` | `active: boolean` | 无 | 防止系统选择文件时失焦折叠窗口 |
| **Send** | `set-window-pinned` | `pinned: boolean` | 无 | 置顶悬浮框 |
| **Send** | `re-summon-window` | 无 | 无 | 强制重新唤醒窗口 |
| **Send** | `toggle-devtools` | 无 | 无 | 切换控制台面板 |
| **Send** | `show-notification` | `title, body` | 无 | 发送系统桌面横幅通知 |
| **Send** | `start-chat-completion` | `reqId, ChatRunOptions` | 无 | 启动对话流（包括 Agent 与 Chat） |
| **Send** | `start-agent-skill` | `reqId, AgentSkillRunOptions` | 无 | 启动特定 Agent 技能运行 |
| **Send** | `respond-tool-permission`| `reqId, callId, approved` | 无 | 反馈安全确认响应 |
| **Send** | `abort-generation` | `reqId` | 无 | 中断该次生成 |

---

## 12. 多层缓存体系

QuickAI 建立了四层多级缓存结构，分工明确，保障性能与安全：

| 缓存类型 | 存储位置 | 生命周期 | 淘汰策略 | 清理时机 | 功能目的 |
| --- | --- | --- | --- | --- | --- |
| **ActionLog** | `{userData}/action_logs/{sessionId}.jsonl` | 跨会话持久化 | 最多 500 条 | 会话清除 / 删除时物理移出磁盘 | 供 Agent 使用 `list_past_actions` 查询历史工具行动轨迹，支持参数脱敏 |
| **ResourceCache** | SQLite (`resource_cache` / `resource_chunks`) | 跨会话共享持久化 | 字符数超出 2MB 则淘汰旧 chunk | 当前会话被清理且该资源不被其他存活会话引用 (Orphan Pruning) | 对 `fetch_url` 网页抓取的大数据量文本分块索引，支持分页重读 |
| **ToolOutputStore** | 内存 Map ([AgentRunContext.ts](file:///d:/Git/Quick%20Ai/src/main/agent/AgentRunContext.ts)) | Run 级别（临时） | 最大 5MB | 运行退出/销毁时释放内存 | 临时缓存超出 2000 字符的巨量工具输出，防止在 Trim 时永久丢失 |
| **RunCheckpoint** | `{userData}/run_checkpoints/{sessionId}/{reqId}.json` | Run 级别（半持久） | 无 | 关联会话删除或清理时 | 存储单 Turn 的执行切片消息，为 Resume 中断恢复提供基准数据 |

---

## 13. 系统安全模型与纵深防御

作为一个拥有本地磁盘文件读写和 Shell 命令执行能力的 Agent 系统，应用采用了多层纵深安全机制。

### 13.1 权限过滤宪法 —— [constitution.ts](file:///d:/Git/Quick%20Ai/src/main/agent/constitution.ts)

每次工具执行前，`evaluateToolGuard()` 会联合 [commandSafety.ts](file:///d:/Git/Quick%20Ai/src/main/agent/commandSafety.ts) 进行参数级的静态分析与权限**动态升级（Escalation）**：
- **越狱逃逸防御**：检查输入的文件路径中是否包含 `..` 遍历、绝对路径、用户根目录 `~` 或系统环境变量（`$HOME`）。一旦发现有逃逸 Workspace (`~/quickai/`) 的企图，权限动态强制更改为 `deny` 并直接阻断执行。
- **敏感文件拦截**：如果检测到文件路径中包含 `.env`、`id_rsa`、`.pem`、`.key`、`.git`、`id_ecdsa` 等潜在敏感信息文件，将自动把原本处于 `allow` 的读取权限升级为 `ask`（弹窗强阻断，必须用户手动点击确认）。
- **Shell 命令风险评级**：
  - `dangerous` (高危，强制 `deny` 拦截)：包含 `rm -rf` 系统路径、`mkfs`、`dd`、`shutdown`、多命令拼装 (分号/管道) 等。
  - `requires_approval` (需授权，强制 `ask`)：未知命令或普通的 `rm` 操作等。
  - `safe` (安全，执行)：`ls`、`cat`、`grep`、`pwd` 等只读与无副作用命令。

### 13.2 运行时行为保护 (LoopGuard & SSRF)

- **LoopGuard (死循环熔断)**：[loopGuard.ts](file:///d:/Git/Quick%20Ai/src/main/agent/loopGuard.ts) 会将工具调用的入参计算稳定哈希。如果发现模型对同名工具及相同参数发起大于等于 3 次的重复调用，会直接阻断并返回提示。如果同一个工具连续报错发生大于等于 8 次，将强行熔断并迫使模型进入 Final Answer，防止 API 被无限循环调用刷爆。
- **SSRF 拦截**：[webTools.ts](file:///d:/Git/Quick%20Ai/src/main/webTools.ts) 在发起网页抓取请求时，会首先进行 DNS 预解析，检查解析出的 IP 是否命中内网私有网段（如 `127.0.0.1`、`192.168.x.x` 等）。如果是，则直接阻断以避免恶意网页利用 Agent 进行内网刺探或内网服务重定向攻击。
- **ActionLog 数据脱敏**：[actionLog.ts](file:///d:/Git/Quick%20Ai/src/main/agent/actionLog.ts) 在写盘或输出时，使用脱敏机制，发现 `apiKey`、`secret`、`password` 等敏感参数键时自动以 `[redacted]` 填充，避免 API 密钥以明文形式泄露在日志文件中。

---

## 14. 测试体系

应用基于 **Vitest 4** 框架搭建了完善的测试体系，重点覆盖逻辑复杂的 Agent 循环、数据库迁移以及安全卫士模块。

### 14.1 核心测试用例分类

| 测试类 | 测试文件 | 测试的核心边界 |
| --- | --- | --- |
| **数据库/持久化** | `database.ts` | SQLite 结构校验、自动迁移合并逻辑测试、外键及级联删除校验 |
| **Agent 执行** | `agentLoop.test.ts` | 步数上限控制、故障中断与恢复测试、分支轨迹隔离与重载测试 |
| **行动日志管理** | `actionLog.test.ts` | JSONL 读写速度测试、敏感密钥过滤红线校验、FIFO 内存溢出测试 |
| **安全宪法守卫** | `constitution.test.ts` | 逃逸路径拦截率、敏感配置读取拦截、高危 shell 命令评估准确度 |
| **LoopGuard 熔断** | `loopGuard.test.ts` | 循环哈希防重放机制、最大重试次数阶梯警告、失败阈值halt截断 |
| **SSRF 网络防护** | `webTools.test.ts` | 本地回环地址拦截效果、重定向追溯检查、级联搜索引擎切换逻辑 |
| **消息裁剪机制** | `contextManager.test.ts`| 两阶段裁剪中大工具输出转换为 retrievable pointer 效果、旧消息整组裁剪 |
