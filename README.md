# QuickAI 🚀

> 一个基于 **Electron + React + TypeScript** 的 Spotlight 风格桌面 AI 智能体助手。支持多模型服务商、Git 版本化长期记忆、步骤级任务追踪，以及强大的分支会话派生与在线中断恢复。

---

## ✨ 核心特性

- 🎯 **唤醒即用**：支持 `Alt+/` 全局快捷键在屏幕正上方 Spotlight 位置瞬时召唤或隐藏窗口，支持失焦自动隐藏及置顶锁定。
- 🤖 **ReAct Agent 智能体**：内置 ReAct（Reasoning + Acting）思考循环，支持自主调用多达 15+ 种系统、文件和网络工具。
- 🔄 **分支会话派生 (Branching)**：随时可在历史对话中编辑或重新生成消息。系统会自动创建克隆分支会话，并同步复制历史执行状态与运行切片。
- ⏳ **故障中断恢复 (Resume)**：当 Agent 由于网络或模型限制中断时，支持通过 `RunCheckpoint` 自动在线恢复执行，无需重复运行有副作用的成功工具。
- 💾 **本地 SQLite 关系型存储**：数据全量迁移至 SQLite 并开启 WAL 性能优化模式，支持完整的多表级联删除与网页缓存分块持久化。
- 📚 **Git 长期记忆系统**：支持自动 Git 版本控制的长期 Markdown 记忆体系，提供 `always.md` 静态注入、按需 Task Group 加载，保障记忆的历史可追溯性。
- 🔍 **安全纵深防御**：内置防路径逃逸、敏感配置拦截、词法 Shell 命令危险度扫描、DNS 解析防内网 SSRF 探测等多重安全策略。

---

## 🛠️ 技术架构

欲了解详细的主进程设计、数据流向、IPC 通道结构以及安全宪法设计，请阅读项目完整的 **[ARCHITECTURE.md (技术架构文档)](file:///d:/Git/Quick%20Ai/ARCHITECTURE.md)**。

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

### 3. 应用构建打包

根据运行的操作系统构建原生安装包：

```bash
# Windows 平台打包
$ npm run build:win

# macOS 平台打包
$ npm run build:mac

# Linux 平台打包
$ npm run build:linux
```

---

## 📂 目录结构说明

- `src/main/`：基于 Node.js 运行的主进程。包含数据库持久化、网络分块缓存、模块化工具集、Git 长期记忆与 Agent 主循环驱动。
- `src/preload/`：预加载桥接层。通过 `contextBridge` 实现安全的进程级通信与有限能力隔离。
- `src/renderer/src/`：React 渲染进程前端界面。包含 UI 状态机骨架、 Spotlight 指令自动补全、文件拖拽粘贴与多服务商配置面板。
- `src/shared/`：三端共享的 TypeScript 契约接口与事件类型系统。

---

## 🤝 推荐开发工具

- **IDE**：[VSCode](https://code.visualstudio.com/)
- **扩展**：[ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
