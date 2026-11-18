# QuickAI 🚀

**简体中文** · [English](README.en.md)

> **项目说明**：这是一个用于学习和练习 Harness/Agent 设计与实现的项目，整体仍比较粗糙。GitHub 上已经有许多类似产品；QuickAI 并不试图重复它们，而是用于承载和实践我对 Harness/Agent 的一些尚不成熟的想法，其中部分已经在项目中得到实现。

> 一个基于 **Electron + React + TypeScript** 的 Spotlight 风格桌面 AI 智能体助手。支持多模型服务商、Git 版本化长期记忆、步骤级任务追踪，以及强大的分支会话派生与在线中断恢复。

---

## ✨ 核心特性

- 🎯 **唤醒即用**：支持 `Alt+/` 全局快捷键在屏幕正上方 Spotlight 位置瞬时召唤或隐藏窗口，支持失焦自动隐藏及置顶锁定。支持 `/` 指令、`@` 技能与模型服务商、`#` 历史会话的前端智能自动补全。
- 🤖 **ReAct Agent 智能体**：内置 ReAct（Reasoning + Acting）思考循环，支持自主调用多达 15+ 种系统、文件和网络工具。
- 🔌 **模型上下文协议 (MCP) 集成**：内置 stdio 传输协议的 MCP 客户端，支持通过配置文件 `mcp.json` 或设置界面动态接入外部 MCP 服务端，无限扩展智能体工具箱。
- 🧩 **渐进式技能系统 (Skill Package)**：支持通过 Markdown 格式的 Skill 文件夹（包含 `SKILL.md`、`agents/quickai.yaml` 界面元数据及辅助脚本/参考文档）来定义和导入智能体专属技能，具备按需渐进式加载机制。
- 🔄 **分支会话派生 (Branching)**：随时可在历史对话中编辑或重新生成消息。系统会自动创建克隆分支会话，并同步复制历史执行状态、行动日志与运行切片，确保分支探索无副作用。
- ⏳ **故障中断恢复 (Resume)**：当 Agent 由于网络、模型限制或人工中止中断时，支持通过 `RunCheckpoint` 自动在线恢复执行，无需重复运行有副作用的成功工具。
- 💾 **本地 SQLite 关系型存储**：数据全量迁移至 SQLite 并开启 WAL 性能优化模式，支持完整的多表级联删除与网页缓存分块持久化，性能卓越。
- 📚 **Git 长期记忆系统**：支持自动 Git 版本控制的长期 Markdown 记忆体系，提供 `always.md` 静态注入、按需 Task Group 加载，保障记忆的历史可追溯性。
- 📁 **多模态与文件解析**：原生支持拖拽或粘贴图片及 PDF 附件，内置 `imageReadTool` 图片解析及 `pdfReadTool` 文本提取工具。
- 🔍 **安全纵深防御**：内置防路径逃逸、敏感文件（如 `.env`, `.pem`）读取升级强阻断、词法 Shell 命令危险度评级与黑名单防御、DNS 解析防内网 SSRF 探测等多重安全防御宪法。

---

## 🛠️ 技术架构

欲了解详细的主进程设计、数据流向、SQLite 表结构、IPC 通道结构以及安全宪法设计，请阅读项目完整的 **[ARCHITECTURE.md (技术架构文档)](ARCHITECTURE.md)**。

项目中已修复问题的原因、处理方式和验证记录，见 [Bug 复盘笔记](docs/bug-retrospective.md)。

---

## 🚀 快速开始

### 1. 克隆与安装依赖

```bash
# 安装 NPM 依赖项
$ npm install
```

### 2. 本地开发调试

启动 Electron 热加载开发环境：

```bash
$ npm run dev
```

### 3. 运行单元与集成测试

测试使用 Vitest，由启动脚本自动通过 Electron 自带的 Node 运行，以匹配 SQLite 原生模块；每轮使用独立的临时数据目录，默认最多两个 worker：

```bash
$ npm run test
```

日常开发可以只运行相关文件，或进入监听模式：

```bash
$ npm test -- src/main/tools/fileMutationTools.test.ts
$ npm run test:watch
```

GitHub Actions 的 [CI 工作流](.github/workflows/ci.yml) 会在推送到 `main` / `master`、创建或更新 Pull Request 时自动运行，也可以在 Actions 页面手动触发。CI 在 Windows 上依次执行 `npm ci`、代码与 CSS 令牌检查、TypeScript 检查及生产构建、全量测试。全量测试使用合成数据和模拟服务商，不需要配置 API Key；真实模型与桌面交互仍需单独验收。

### 4. 应用构建打包

根据运行的操作系统构建原生安装包：

```bash
# Windows 平台打包
$ npm run build:win

# macOS 平台打包
$ npm run build:mac

# Linux 平台打包
$ npm run build:linux
```

Windows 免安装包生成后，可检查实际归档是否只包含运行时文件，以及应用入口和 SQLite 原生模块是否完整：

```bash
$ npm run check:package
```

---

## 📂 目录结构说明

- `src/main/`：基于 Node.js 运行的主进程。包含 SQLite 数据库持久化、网络分块缓存、模块化工具集、MCP 客户端管理器、Git 长期记忆与 Agent 主循环驱动。
  - `src/main/agent/`：Agent 执行引擎（ReAct Loop、思考解析、运行时切片、提示词编排等）。
  - `src/main/database/`：SQLite 持久化存储与 JSON 数据迁移逻辑。
  - `src/main/memory/`：长期记忆的文件管理与自动 Git 版本控制。
  - `src/main/tools/`：模块化动态工具箱。
- `src/preload/`：预加载桥接层。通过 `contextBridge` 实现安全的进程级通信与有限能力隔离。
- `src/renderer/src/`：React 渲染进程前端界面。
  - `src/renderer/src/components/`：UI 组件（Spotlight 补全输入框、Task 步骤面板、MCP/Skill 管理器面板等）。
  - `src/renderer/src/hooks/`：状态管理与业务 Hook（分支派生、会话列表、模型服务商配置等）。
- `src/shared/`：三端共享的 TypeScript 契约接口与事件类型系统。

---

## 🤝 推荐开发工具

- **IDE**：[VSCode](https://code.visualstudio.com/)
- **扩展**：[ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
