# Project Structure Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue reducing oversized mixed-responsibility files while preserving the current Electron, React, agent, and tool behavior.

**Architecture:** Keep the current top-level `src/main`, `src/preload`, `src/renderer`, and `src/shared` boundaries. Refactor inside those boundaries first: split large files by responsibility, keep existing public facades where callers already depend on them, and avoid broad path moves until responsibilities are clear.

**Tech Stack:** Electron, React, TypeScript, Vitest, better-sqlite3, MCP SDK.

---

## Current Structure Audit

### Healthy Boundaries

- `src/main` owns Electron main process, agent loop, tool execution, persistence, MCP, and OS integration.
- `src/preload` exposes a typed `window.api` bridge; renderer code uses `window.api` rather than importing main-process modules.
- `src/renderer/src` owns React UI, hooks, and UI-only utilities.
- `src/shared` owns cross-process data types and pure shared helpers.
- Recent tool refactors moved file mutation, file read, workspace search, and workspace listing into focused modules under `src/main/tools`.

### Current Large Production Files

- `src/renderer/src/App.tsx` - 1318 lines. Mixes app composition, project/session navigation, message scroll/navigation, autocomplete handling, permission handling, and window state.
- `src/renderer/src/components/MessageBubble.tsx` - 1157 lines. Mixes message rendering, agent run status, tool display helpers, tool detail modal, message actions, cache/runtime metadata, and memoization logic.
- `src/main/database.ts` - 1143 lines. Mixes database connection, schema creation, JSON migration, and stores for settings, providers, projects, sessions, skills, and resources.
- `src/main/webTools.ts` - 1127 lines. Mixes URL safety, HTML parsing, search provider parsing, fetch pagination, JS rendering fallback, search caching, and exported web functions.
- `src/main/index.ts` - 745 lines. Mixes window lifecycle, tray/shortcut behavior, IPC registration, MCP wiring, store access, memory handlers, and chat start handlers.
- `src/main/skillManager.ts` - 738 lines. Mixes system skill installation, skill interface metadata parsing, directory discovery, folder watching, loading, and saving.
- `src/main/tools/codeSymbolTool.ts` - 509 lines. Mixes symbol matching, block range inference, workspace scanning, result formatting, and tool definition.
- `src/main/tools/shell.ts` - 309 lines. Mixes command metadata, encoding detection, process streaming, result formatting, and tool definition.

### Lower Priority Large Files

- `src/main/agent/agentLoop.test.ts` and `src/main/fileTools.test.ts` are large test files. They are not the first risk because production code was already split and tests still provide integration coverage.
- `src/renderer/src/utils/messageFormat.tsx` is large and important, but it contains both Markdown rendering and agent event parsing. Split it after `MessageBubble.tsx` starts consuming smaller display helpers.

---

## Target Folder Shape

Keep this as the direction for future refactors:

```text
src/main/
  agent/                 agent loop, tool turn orchestration, context building
  database/              schema, migrations, entity stores
  ipc/                   IPC registration grouped by feature
  memory/                durable memory store and git integration
  mcp/                   MCP config, connection, tool adapter
  tools/                 built-in tool definitions and result formatting
  web/                   fetch/search/html parsing internals

src/renderer/src/
  components/            reusable UI components
  features/chat/         chat screen composition and message navigation
  features/settings/     settings screen composition
  hooks/                 cross-feature React hooks
  utils/                 pure UI helpers

src/shared/
  modelContext.ts
  modelCatalog.ts
  skillParser.ts
  tokenEstimator.ts
  types.ts              keep public types, split later only when churn slows
```

Do not create all folders at once. Create each folder only when a file is actually moved into it.

---

### Task 1: Split Code Symbol Tool Internals

**Files:**
- Create: `src/main/tools/codeSymbolPatterns.ts`
- Create: `src/main/tools/codeSymbolPatterns.test.ts`
- Create: `src/main/tools/codeSymbolSnippet.ts`
- Create: `src/main/tools/codeSymbolSnippet.test.ts`
- Modify: `src/main/tools/codeSymbolTool.ts`
- Run existing: `src/main/fileTools.test.ts`

- [ ] **Step 1: Write failing tests for symbol pattern matching**

```ts
import { describe, expect, it } from 'vitest'
import { buildSymbolDefinitionPatterns, findSymbolMatchesInContent } from './codeSymbolPatterns'

describe('codeSymbolPatterns', () => {
  it('matches TypeScript function and class declarations', () => {
    const patterns = buildSymbolDefinitionPatterns('targetFn')
    const matches = findSymbolMatchesInContent(
      'export function targetFn() { return 1 }\\nclass Other {}',
      'targetFn',
      patterns
    )

    expect(matches).toHaveLength(1)
    expect(matches[0].kind).toBe('function')
    expect(matches[0].lineNumber).toBe(1)
  })

  it('matches Python function declarations', () => {
    const patterns = buildSymbolDefinitionPatterns('load_data')
    const matches = findSymbolMatchesInContent('async def load_data(path):\\n    return path', 'load_data', patterns)

    expect(matches).toHaveLength(1)
    expect(matches[0].kind).toBe('python_function')
  })
})
```

- [ ] **Step 2: Run pattern tests to verify RED**

Run: `npx vitest run src/main/tools/codeSymbolPatterns.test.ts`

Expected: FAIL because `./codeSymbolPatterns` does not exist.

- [ ] **Step 3: Extract pattern helpers**

Move these existing units from `src/main/tools/codeSymbolTool.ts` into `src/main/tools/codeSymbolPatterns.ts`:

```ts
export interface SymbolLineMatch {
  lineIndex: number
  lineNumber: number
  lineText: string
  kind: string
}

export function buildSymbolDefinitionPatterns(symbol: string): Array<{ kind: string; regex: RegExp }>
export function lineMayContainSymbol(line: string, symbol: string): boolean
export function findSymbolMatchesInContent(
  content: string,
  symbol: string,
  patterns?: Array<{ kind: string; regex: RegExp }>
): SymbolLineMatch[]
```

Keep regex behavior unchanged. Import `escapeRegExp` from `./helpers`.

- [ ] **Step 4: Verify pattern tests GREEN**

Run: `npx vitest run src/main/tools/codeSymbolPatterns.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing tests for symbol snippet extraction**

```ts
import { describe, expect, it } from 'vitest'
import { buildBoundedSymbolBlock, inferSymbolBlockRange } from './codeSymbolSnippet'

describe('codeSymbolSnippet', () => {
  it('includes decorators above Python blocks', () => {
    const lines = ['@decorator', 'def target():', '    return 1', '', 'def other():', '    return 2']
    const range = inferSymbolBlockRange(lines, 1)

    expect(range.start).toBe(0)
    expect(range.end).toBe(2)
  })

  it('truncates very large symbol blocks', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(600)}`)
    const result = buildBoundedSymbolBlock(lines)

    expect(result.truncated).toBe(true)
    expect(result.block.length).toBeLessThanOrEqual(61000)
  })
})
```

- [ ] **Step 6: Run snippet tests to verify RED**

Run: `npx vitest run src/main/tools/codeSymbolSnippet.test.ts`

Expected: FAIL because `./codeSymbolSnippet` does not exist.

- [ ] **Step 7: Extract snippet helpers**

Move these existing units from `src/main/tools/codeSymbolTool.ts` into `src/main/tools/codeSymbolSnippet.ts`:

```ts
export function normalizeLineNumberArg(value: unknown, fallback: number): number
export function countIndent(line: string): number
export function includeLeadingDecorators(lines: string[], start: number): number
export function stripQuotedText(line: string): string
export function inferSymbolBlockRange(lines: string[], start: number): { start: number; end: number }
export function buildBoundedSymbolBlock(lines: string[]): { block: string; truncated: boolean }
```

Keep `MAX_SYMBOL_BLOCK_CHARS` and `MAX_SYMBOL_BLOCK_LINE_CHARS` in this module.

- [ ] **Step 8: Update `codeSymbolTool.ts` imports**

`src/main/tools/codeSymbolTool.ts` should keep:

```ts
import {
  buildSymbolDefinitionPatterns,
  findSymbolMatchesInContent,
  lineMayContainSymbol,
  SymbolLineMatch
} from './codeSymbolPatterns'
import {
  buildBoundedSymbolBlock,
  inferSymbolBlockRange,
  normalizeLineNumberArg
} from './codeSymbolSnippet'
```

The tool file should still own:

```ts
interface SymbolMatch { ... }
async function scanWorkspaceForSymbol(...)
export const codeSymbolTool: ToolDefinition = { ... }
```

- [ ] **Step 9: Verify code symbol refactor**

Run:

```bash
npx vitest run src/main/tools/codeSymbolPatterns.test.ts src/main/tools/codeSymbolSnippet.test.ts src/main/fileTools.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/main/tools/codeSymbolTool.ts src/main/tools/codeSymbolPatterns.ts src/main/tools/codeSymbolPatterns.test.ts src/main/tools/codeSymbolSnippet.ts src/main/tools/codeSymbolSnippet.test.ts
git commit -m "Split code symbol tool internals"
```

---

### Task 2: Split Shell Tool Internals

**Files:**
- Create: `src/main/tools/shellEncoding.ts`
- Create: `src/main/tools/shellEncoding.test.ts`
- Create: `src/main/tools/shellResult.ts`
- Create: `src/main/tools/shellResult.test.ts`
- Modify: `src/main/tools/shell.ts`
- Run existing: `src/main/shellTool.test.ts`

- [ ] **Step 1: Write failing shell encoding tests**

```ts
import { describe, expect, it } from 'vitest'
import { decodeShellOutputForDisplay } from './shellEncoding'

describe('shellEncoding', () => {
  it('decodes utf8 shell output without replacement characters', () => {
    const result = decodeShellOutputForDisplay(Buffer.from('hello', 'utf8'), 'utf8')

    expect(result.text).toBe('hello')
    expect(result.encoding).toBe('utf8')
  })
})
```

- [ ] **Step 2: Run encoding test to verify RED**

Run: `npx vitest run src/main/tools/shellEncoding.test.ts`

Expected: FAIL because `./shellEncoding` does not exist.

- [ ] **Step 3: Extract encoding helpers**

Move these units from `src/main/tools/shell.ts` into `src/main/tools/shellEncoding.ts`:

```ts
export function decodeShellOutputForDisplay(
  buffer: Buffer,
  preferredEncoding?: string
): { text: string; encoding: string }
```

Keep private helpers in this module:

```ts
function decodeBuffer(buffer: Buffer, encoding: string): string
function countReplacementChars(value: string): number
function getShellFallbackEncoding(): string
```

- [ ] **Step 4: Write failing shell result tests**

```ts
import { describe, expect, it } from 'vitest'
import { buildShellDetails, trimLivePreview } from './shellResult'

describe('shellResult', () => {
  it('builds command output details with exit metadata', () => {
    const details = buildShellDetails({
      command: 'echo hello',
      code: 0,
      durationMs: 12,
      output: 'hello\\n'
    })

    expect(details).toContain('Execute Command: echo hello')
    expect(details).toContain('Command exited with code 0 after 12ms')
    expect(details).toContain('hello')
  })

  it('trims long live previews', () => {
    expect(trimLivePreview('x'.repeat(9000))).toHaveLength(8000)
  })
})
```

- [ ] **Step 5: Run result test to verify RED**

Run: `npx vitest run src/main/tools/shellResult.test.ts`

Expected: FAIL because `./shellResult` does not exist.

- [ ] **Step 6: Extract result formatting helpers**

Move these units from `src/main/tools/shell.ts` into `src/main/tools/shellResult.ts`:

```ts
export function trimLivePreview(details: string): string
export function buildShellDetails(args: {
  command: string
  code: number | null
  durationMs: number
  output: string
}): string
```

- [ ] **Step 7: Update `shell.ts` imports**

`src/main/tools/shell.ts` should import:

```ts
import { decodeShellOutputForDisplay } from './shellEncoding'
import { buildShellDetails, trimLivePreview } from './shellResult'
```

`shell.ts` should still own process spawning and tool definition until a later runner split is needed.

- [ ] **Step 8: Verify shell refactor**

Run:

```bash
npx vitest run src/main/tools/shellEncoding.test.ts src/main/tools/shellResult.test.ts src/main/shellTool.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/main/tools/shell.ts src/main/tools/shellEncoding.ts src/main/tools/shellEncoding.test.ts src/main/tools/shellResult.ts src/main/tools/shellResult.test.ts
git commit -m "Split shell tool internals"
```

---

### Task 3: Split Web Tool Internals

**Files:**
- Create folder: `src/main/web`
- Create: `src/main/web/urlSafety.ts`
- Create: `src/main/web/htmlExtract.ts`
- Create: `src/main/web/searchParsers.ts`
- Create: `src/main/web/fetchPublicText.ts`
- Modify: `src/main/webTools.ts`
- Run existing: `src/main/webTools.test.ts`

- [ ] **Step 1: Extract URL safety helpers with tests**

Move these exports into `src/main/web/urlSafety.ts`:

```ts
export function normalizeFetchUrlOptions(...)
export function isPrivateIPv4(address: string): boolean
export function isPrivateIPv6(address: string): boolean
```

Add `src/main/web/urlSafety.test.ts` covering private IPv4 and IPv6 rejection.

- [ ] **Step 2: Extract HTML text helpers with tests**

Move these exports into `src/main/web/htmlExtract.ts`:

```ts
export function stripHtml(html: string): string
export function stripHtmlWithLinks(...)
export function extractMainContentHtml(html: string): string | null
export function renderWithLineNumbers(text: string, startLine?: number): string
```

Add `src/main/web/htmlExtract.test.ts` covering link extraction and line numbering.

- [ ] **Step 3: Extract search parsers with tests**

Move these exports into `src/main/web/searchParsers.ts`:

```ts
export interface WebSearchResult { ... }
export function parseDuckDuckGoResults(html: string, limit?: number): WebSearchResult[]
export function parseBingResults(html: string, limit?: number): WebSearchResult[]
export function parseSogouResults(html: string, limit?: number): WebSearchResult[]
export function formatSearchResultsForModel(results: WebSearchResult[]): string
```

Run existing parser coverage from `src/main/webTools.test.ts` after moving.

- [ ] **Step 4: Keep `webTools.ts` as facade**

`src/main/webTools.ts` should continue exporting the names existing callers use:

```ts
export { normalizeFetchUrlOptions, isPrivateIPv4, isPrivateIPv6 } from './web/urlSafety'
export { stripHtml, stripHtmlWithLinks, extractMainContentHtml, renderWithLineNumbers } from './web/htmlExtract'
export { parseDuckDuckGoResults, parseBingResults, parseSogouResults, formatSearchResultsForModel } from './web/searchParsers'
```

Leave `fetchUrl`, `webSearchDetailed`, `webSearch`, `setHtmlRenderer`, and `clearWebSearchCache` in `webTools.ts` until the facade is stable.

- [ ] **Step 5: Verify web refactor**

Run:

```bash
npx vitest run src/main/webTools.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/web src/main/webTools.ts src/main/webTools.test.ts
git commit -m "Split web tool helpers"
```

---

### Task 4: Split Database Stores Behind Existing Facade

**Files:**
- Create folder: `src/main/database`
- Create: `src/main/database/connection.ts`
- Create: `src/main/database/schema.ts`
- Create: `src/main/database/settingsStore.ts`
- Create: `src/main/database/projectStore.ts`
- Create: `src/main/database/sessionStore.ts`
- Create: `src/main/database/skillStore.ts`
- Create: `src/main/database/resourceStore.ts`
- Modify: `src/main/database.ts`
- Run existing database-dependent tests.

- [ ] **Step 1: Extract connection and schema**

Move `getDb`, `closeDb`, and `createSchema` support into:

```ts
// src/main/database/connection.ts
export function getDb(): Database.Database
export function closeDb(): void

// src/main/database/schema.ts
export function createSchema(database: Database.Database): void
```

Keep `src/main/database.ts` re-exporting `getDb` and `closeDb`.

- [ ] **Step 2: Extract settings and provider persistence**

Move `loadSettings` and `saveSettings` into `src/main/database/settingsStore.ts`:

```ts
export function loadSettings(): AppSettings
export function saveSettings(settings: AppSettings): void
```

`src/main/database.ts` re-exports these functions.

- [ ] **Step 3: Extract projects, sessions, skills, and resources one store per commit**

Move in this order:

```ts
src/main/database/projectStore.ts   loadProjects, saveProjects
src/main/database/sessionStore.ts   loadSessions, saveSessions
src/main/database/skillStore.ts     loadSkills, saveSkills
src/main/database/resourceStore.ts  loadResourceCache, upsertResourceCache, upsertResourceChunk, deleteResourceFromDb, getResourceChunkText, pruneResourceChunks, getResourceChunksMetadata, saveResourceLinks, loadResourceLinks, getResourceLink, getResourceFullText
```

Each store imports `getDb` from `./connection`.

- [ ] **Step 4: Verify database refactor**

Run:

```bash
npx vitest run src/main/resourceCache.test.ts src/main/sessionBranchPersistence.test.ts src/main/skillPackagePersistence.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/database.ts src/main/database
git commit -m "Split database stores"
```

---

### Task 5: Split Renderer App Orchestration

**Files:**
- Create: `src/renderer/src/features/chat/messageNavigation.ts`
- Create: `src/renderer/src/features/chat/messageNavigation.test.ts`
- Create: `src/renderer/src/features/chat/useMessageNavigation.ts`
- Create: `src/renderer/src/features/chat/useProjectNavigation.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Extract pure message navigation preview**

Move `buildMessageNavPreview` from `src/renderer/src/App.tsx` into `src/renderer/src/features/chat/messageNavigation.ts`:

```ts
export function buildMessageNavPreview(
  content: string,
  files?: Array<{ name: string; content: string; type: string }>
): string
```

Add tests covering Markdown stripping, image/file fallback, and empty message fallback.

- [ ] **Step 2: Extract message scroll state**

Move these concerns from `App.tsx` into `useMessageNavigation.ts`:

```ts
export function useMessageNavigation(args: {
  activeSession: Session | null | undefined
  isCurrentSessionGenerating: boolean
}): {
  messagesEndRef: React.RefObject<HTMLDivElement>
  messagesContainerRef: React.RefObject<HTMLDivElement>
  messagesInnerRef: React.RefObject<HTMLDivElement>
  showScrollToBottom: boolean
  activeMessageNavId: string | null
  pendingScrollMessageId: string | null
  scrollToBottom: (behavior?: ScrollBehavior) => void
  scrollToMessage: (messageId: string) => void
  handleScroll: () => void
}
```

- [ ] **Step 3: Extract project/sidebar navigation**

Move project list mutations and sidebar selection into `useProjectNavigation.ts`:

```ts
export function useProjectNavigation(args: {
  projects: Project[]
  sessions: Session[]
  activeSessionId: string | null
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setActiveSessionId: (id: string | null) => void
}): {
  sidebarProjectId: string | null | undefined
  setSidebarProjectId: React.Dispatch<React.SetStateAction<string | null | undefined>>
  activeProject: Project | null
  sidebarProject: Project | null
  projectSessionCounts: Map<string, number>
  openProject: (projectId: string) => void
  openFreeConversations: () => void
  handleAddProject: () => Promise<void>
  handleDeleteProject: (projectId: string) => Promise<void>
}
```

- [ ] **Step 4: Verify renderer refactor**

Run:

```bash
npx vitest run src/renderer/src/features/chat/messageNavigation.test.ts src/renderer/src/hooks/useSessions.test.ts src/renderer/src/hooks/useChatCompletion.test.ts
npm run typecheck:web
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/features/chat
git commit -m "Split chat app orchestration"
```

---

### Task 6: Split Message Bubble Display Helpers

**Files:**
- Create: `src/renderer/src/components/message/ToolDetailModal.tsx`
- Create: `src/renderer/src/components/message/toolDisplay.ts`
- Create: `src/renderer/src/components/message/toolDisplay.test.ts`
- Create: `src/renderer/src/components/message/MessageActions.tsx`
- Modify: `src/renderer/src/components/MessageBubble.tsx`

- [ ] **Step 1: Extract tool display helpers**

Move these helpers from `MessageBubble.tsx` into `toolDisplay.ts`:

```ts
export function formatToolArgsSummary(toolName: string, args: unknown): string
export function getShellCommandArg(toolName: string, args: unknown): string
export function formatToolDisplayText(toolName: string, args: unknown, purpose?: string): string
export function getToolArgsJson(args: unknown): string
export function getToolStatusLabel(status: ParsedToolCall['status']): string
export function formatCacheHitRate(cacheStats: Message['cacheStats']): string | null
```

Add tests for shell command display, file path display, query display, and denied/failed status labels.

- [ ] **Step 2: Extract tool detail modal**

Move `ToolDetailModal` into `ToolDetailModal.tsx` and pass only:

```ts
interface ToolDetailModalProps {
  toolCall: ParsedToolCall
  onClose: () => void
}
```

`MessageBubble.tsx` should import and render the modal.

- [ ] **Step 3: Extract message action buttons**

Move copy, regenerate, resume, and edit action button markup into `MessageActions.tsx`:

```ts
interface MessageActionsProps {
  canEdit: boolean
  canRegenerate: boolean
  canResume: boolean
  copied: boolean
  onCopy: () => void
  onEdit: () => void
  onRegenerate: () => void
  onResume: () => void
}
```

- [ ] **Step 4: Verify message bubble refactor**

Run:

```bash
npx vitest run src/renderer/src/components/message/toolDisplay.test.ts src/renderer/src/utils/messageFormat.test.ts
npm run typecheck:web
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/MessageBubble.tsx src/renderer/src/components/message
git commit -m "Split message bubble display helpers"
```

---

## Execution Order

1. Task 1: `codeSymbolTool.ts`, because it is already a known runtime-risk area.
2. Task 2: `shell.ts`, because streaming output and encoding behavior will keep changing.
3. Task 3: `webTools.ts`, because it has the highest helper density and good existing tests.
4. Task 4: `database.ts`, because it is large but high-risk; do it after smaller splits.
5. Task 5: `App.tsx`, because UI behavior is user-visible and benefits from prior backend stability.
6. Task 6: `MessageBubble.tsx`, because it depends on current agent event and tool result shapes.

## Verification Policy

Before every commit:

```bash
git diff --check
npm run typecheck
```

Run the smallest relevant Vitest target first, then the broader integration target listed in each task.

## Self-Review

- Spec coverage: covers directory boundaries, oversized files, cross-layer dependency concerns, and an execution order.
- Placeholder scan: passed; each task lists exact files and verification commands.
- Type consistency: new helper names match the current source function names observed during the audit.
