# QuickAI 🚀

[简体中文](README.md) · **English**

> **About this project** — QuickAI is a personal project for learning how to design and build agent harnesses. It is still rough around the edges and gives me a place to try out ideas, some of which are already implemented here.

> A Spotlight-style desktop AI assistant built with **Electron, React, and TypeScript**. It supports multiple model providers, Git-backed long-term memory, step-by-step task tracking, conversation branching, and interrupted run recovery.

---

## ✨ Features

- 🎯 **Quick access** — Press `Alt+/` to show or hide the Spotlight-style window. The window can hide when it loses focus or stay pinned. Use `/` for commands, `@` for skills and providers, and `#` for past conversations.
- 🤖 **ReAct agent** — The reasoning and acting loop can call built-in tools for system tasks, files, and the web.
- 🔌 **Model Context Protocol (MCP)** — Connect external MCP servers over stdio through `mcp.json` or the settings interface.
- 🧩 **Skill packages** — Define and import skills as folders containing `SKILL.md`, optional interface metadata in `agents/quickai.yaml`, and supporting scripts or references. Contents load on demand.
- 🔄 **Conversation branching** — Edit or regenerate a message from an earlier point to create a branch. The branch carries over relevant run history, action logs, and checkpoints.
- ⏳ **Run recovery** — Resume an agent run from a `RunCheckpoint` after a network error, model limit, or manual stop. Recovery accounts for completed tools with side effects.
- 💾 **Local SQLite storage** — Stores conversations and related data in SQLite with WAL mode, cascading deletions, and chunked web caches.
- 📚 **Git-backed long-term memory** — Keeps Markdown memory under version control. `always.md` provides persistent context, and task-group notes load on demand.
- 📁 **Images and PDFs** — Drag in or paste attachments. The built-in `imageReadTool` handles images, and `pdfReadTool` extracts PDF text.
- 🔍 **Tool safeguards** — Checks file paths and sensitive filenames, classifies shell commands by risk, and checks resolved addresses before fetching web content.

---

## 🛠️ Architecture

See the [architecture guide](ARCHITECTURE.md) (in Chinese) for the main process design, data flow, SQLite schema, IPC channels, and tool policies.

---

## 🚀 Quick start

### 1. Install dependencies

From the repository root:

```bash
npm install
```

### 2. Start development mode

Launch Electron with hot reload:

```bash
npm run dev
```

### 3. Run unit and integration tests

The project uses Vitest for automated tests:

```bash
npm run test
```

### 4. Package the app

Run the command for your target platform:

```bash
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

---

## 📂 Project structure

- `src/main/` — The Node.js main process, including SQLite storage, web caching, tools, MCP, long-term memory, and the agent loop.
  - `src/main/agent/` — Agent execution, run checkpoints, and prompt assembly.
  - `src/main/database/` — SQLite persistence and JSON data migration.
  - `src/main/memory/` — Memory files and Git versioning.
  - `src/main/tools/` — Built-in tool modules.
- `src/preload/` — The preload bridge, which exposes selected IPC capabilities through `contextBridge`.
- `src/renderer/src/` — The React interface.
  - `src/renderer/src/components/` — UI components such as the Spotlight input, task panel, and MCP and skill settings.
  - `src/renderer/src/hooks/` — State and feature hooks for conversation branches, session history, and provider settings.
- `src/shared/` — TypeScript interfaces and event types shared across processes.

---

## 🤝 Recommended development tools

- **Editor** — [Visual Studio Code](https://code.visualstudio.com/)
- **Extensions** — [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) and [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
