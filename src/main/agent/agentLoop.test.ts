import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { runAgentLoop } from './agentLoop'
import { callModel } from './callModel'
import { ToolRegistry } from '../toolRegistry'
import { globalPermissionManager } from './permissionManager'
import { BrowserWindow } from 'electron'
import { abortRun } from './AgentRunContext'
import { ActionLog, getActionLogPath } from './actionLog'
import { loadRunManifest } from './runManifest'

vi.mock('electron', () => ({
  BrowserWindow: {},
  app: {
    getPath: () => join(tmpdir(), 'quickai-agentloop-test')
  }
}))

vi.mock('./callModel', () => ({
  callModel: vi.fn()
}))

vi.mock('./memoryContext', () => ({
  loadMemoryContextPrompt: vi.fn(() => ''),
  buildMemoryInjection: vi.fn(() => '')
}))

describe('runAgentLoop', () => {
  let mockWindow: BrowserWindow
  let sendMock: Mock

  beforeEach(() => {
    vi.clearAllMocks()
    // Clear any persisted action logs so each test starts with an empty history (otherwise
    // a prior run's log would auto-activate the list_past_actions/get_past_action tools).
    rmSync(join(tmpdir(), 'quickai-agentloop-test', 'action_logs'), {
      recursive: true,
      force: true
    })
    rmSync(join(tmpdir(), 'quickai-agentloop-test', 'run_checkpoints'), {
      recursive: true,
      force: true
    })
    rmSync(join(tmpdir(), 'quickai-agentloop-test', 'run_manifests'), {
      recursive: true,
      force: true
    })
    sendMock = vi.fn()
    mockWindow = {
      webContents: {
        send: sendMock
      }
    } as unknown as BrowserWindow

    // Stub tool executions to prevent real fetches
    vi.spyOn(ToolRegistry.fetch_url, 'execute').mockResolvedValue({
      resultForModel: 'Fetched page content',
      resultForUi: {
        title: 'Example Title',
        url: 'https://example.com',
        summary: 'Example summary'
      }
    })
    vi.spyOn(ToolRegistry.web_search, 'execute').mockResolvedValue({
      resultForModel: 'Search results',
      resultForUi: { title: 'Search: test', summary: 'Search results summary' }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('directory tools are declared up front and an unknown tool is blocked', async () => {
    let callCount = 0
    vi.mocked(callModel).mockImplementation(async (options, messages, tools) => {
      void options
      callCount++
      if (callCount === 1) {
        // First turn (dynamic mode): the discoverable directory tools are declared up front
        // alongside search_tools, so the model can call them directly.
        const names = tools?.map((t) => t.function.name) || []
        expect(names).toContain('search_tools')
        expect(names).toContain('fetch_url')
        expect(names).toContain('web_search')
        // Model tries to call a tool that does not exist in the registry at all.
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-unknown',
              type: 'function',
              function: {
                name: 'nonexistent_tool',
                arguments: JSON.stringify({ foo: 'bar' })
              }
            }
          ]
        }
      }
      if (callCount === 2) {
        // Second turn: verify that the model received the error block observation
        const lastMsg = messages[messages.length - 1]
        expect(lastMsg.role).toBe('tool')
        expect(lastMsg.content).toContain('Tool execution blocked')
        return {
          role: 'assistant',
          content: 'I cannot call that tool.'
        }
      }
      return { role: 'assistant', content: 'done' }
    })

    await runAgentLoop(mockWindow, 'test-req-1', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Hello' }]
    })

    expect(callCount).toBe(2)
  })

  it('denied tool is not declared and blocked from execution', async () => {
    let callCount = 0
    vi.mocked(callModel).mockImplementation(async (options, messages, tools) => {
      void options
      callCount++
      if (callCount === 1) {
        // Directory tools are declared, but web_search must NOT be — it is denied in policy.
        const names = tools?.map((t) => t.function.name) || []
        expect(names).toContain('search_tools')
        expect(names).not.toContain('web_search')
        // Try calling the denied tool anyway
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-deny',
              type: 'function',
              function: { name: 'web_search', arguments: JSON.stringify({ query: 'test' }) }
            }
          ]
        }
      }
      if (callCount === 2) {
        const lastMsg = messages[messages.length - 1]
        expect(lastMsg.role).toBe('tool')
        expect(lastMsg.content).toContain('Tool execution blocked')
        return {
          role: 'assistant',
          content: 'I cannot search.'
        }
      }
      return { role: 'assistant', content: 'done' }
    })

    await runAgentLoop(
      mockWindow,
      'test-req-2',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Search something' }]
      },
      {
        web_search: 'deny'
      }
    )

    expect(callCount).toBe(2)
  })

  it('directly-called ask directory tool prompts for permission (no search_tools first)', async () => {
    // Regression: directory tools are declared up front, so calling an `ask` tool directly must
    // route through the permission prompt instead of being silently denied by the whitelist.
    let callCount = 0
    const permissionSpy = vi
      .spyOn(globalPermissionManager, 'requestPermission')
      .mockResolvedValue(true)

    vi.mocked(callModel).mockImplementation(async (options, messages, tools) => {
      void options
      callCount++
      if (callCount === 1) {
        // web_search is declared from the start even though no search_tools call happened.
        expect(tools?.map((t) => t.function.name)).toContain('web_search')
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-direct-ask',
              type: 'function',
              function: { name: 'web_search', arguments: JSON.stringify({ query: 'direct ask' }) }
            }
          ]
        }
      }
      if (callCount === 2) {
        const lastMsg = messages[messages.length - 1]
        expect(lastMsg.role).toBe('tool')
        // Executed (approved) — not blocked/denied.
        expect(lastMsg.content).toContain('Search results')
        return { role: 'assistant', content: 'Done.' }
      }
      return { role: 'assistant', content: 'done' }
    })

    await runAgentLoop(
      mockWindow,
      'test-req-direct-ask',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Search directly' }]
      },
      {
        web_search: 'ask'
      }
    )

    expect(permissionSpy).toHaveBeenCalled()
    expect(callCount).toBe(2)
  })

  it('ask tool triggers permission request and executes if approved', async () => {
    // Enable search_tools to discover and activate web_search
    let callCount = 0
    const permissionSpy = vi
      .spyOn(globalPermissionManager, 'requestPermission')
      .mockResolvedValue(true)

    vi.mocked(callModel).mockImplementation(async (options, messages, tools) => {
      void options
      callCount++
      if (callCount === 1) {
        // Run search_tools
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-search-tools',
              type: 'function',
              function: { name: 'search_tools', arguments: JSON.stringify({ query: 'web' }) }
            }
          ]
        }
      }
      if (callCount === 2) {
        // web_search should now be activated and declared (since it was discovered in turn 1)
        expect(tools?.map((t) => t.function.name)).toContain('web_search')
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-web-search',
              type: 'function',
              function: { name: 'web_search', arguments: JSON.stringify({ query: 'testing ask' }) }
            }
          ]
        }
      }
      if (callCount === 3) {
        // Check that web_search was executed successfully
        const lastMsg = messages[messages.length - 1]
        expect(lastMsg.role).toBe('tool')
        expect(lastMsg.content).toBe('Search results')
        return {
          role: 'assistant',
          content: 'Search matches.'
        }
      }
      return { role: 'assistant', content: 'done' }
    })

    await runAgentLoop(
      mockWindow,
      'test-req-3',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Search testing' }]
      },
      {
        web_search: 'ask'
      }
    )

    expect(permissionSpy).toHaveBeenCalled()
    expect(callCount).toBe(3)
  })

  it('ask tool returns error if permission is denied', async () => {
    let callCount = 0
    const permissionSpy = vi
      .spyOn(globalPermissionManager, 'requestPermission')
      .mockResolvedValue(false)

    vi.mocked(callModel).mockImplementation(async (options, messages) => {
      void options
      callCount++
      if (callCount === 1) {
        // Run search_tools to activate web_search
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-search-tools',
              type: 'function',
              function: { name: 'search_tools', arguments: JSON.stringify({ query: 'web' }) }
            }
          ]
        }
      }
      if (callCount === 2) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-web-search',
              type: 'function',
              function: {
                name: 'web_search',
                arguments: JSON.stringify({ query: 'testing ask deny' })
              }
            }
          ]
        }
      }
      if (callCount === 3) {
        const lastMsg = messages[messages.length - 1]
        expect(lastMsg.role).toBe('tool')
        expect(lastMsg.content).toContain('denied by user')
        return {
          role: 'assistant',
          content: 'Search denied.'
        }
      }
      return { role: 'assistant', content: 'done' }
    })

    await runAgentLoop(
      mockWindow,
      'test-req-4',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Search testing' }]
      },
      {
        web_search: 'ask'
      }
    )

    expect(permissionSpy).toHaveBeenCalled()
    expect(callCount).toBe(3)
  })

  it('safeguard maxSteps ends execution and forces final answer', async () => {
    let callCount = 0
    vi.mocked(callModel).mockImplementation(async (options, messages) => {
      void options
      callCount++
      if (callCount <= 3) {
        // Return a tool call to keep the loop going
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: `tc-${callCount}`,
              type: 'function',
              function: { name: 'search_tools', arguments: JSON.stringify({ query: 'web' }) }
            }
          ]
        }
      }
      // On the final forced turn, we should receive the user message warning about max steps
      const lastUserMsg = messages[messages.length - 1]
      expect(lastUserMsg.role).toBe('user')
      expect(lastUserMsg.content).toContain('maximum number of tool steps has been reached')
      return {
        role: 'assistant',
        content: 'Final summarized answer.'
      }
    })

    // Run agent loop with maxSteps = 3 (via skill options)
    await runAgentLoop(mockWindow, 'test-req-5', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      skill: {
        id: 'test-skill',
        name: 'Test Skill',
        trigger: 'test',
        prompt: 'test prompt',
        maxSteps: 3
      },
      userInput: 'Run test skill'
    })

    // 1st step: callCount 1 (returns tool)
    // 2nd step: callCount 2 (returns tool)
    // 3rd step: callCount 3 (returns tool)
    // 4th step: final summarized call (tools are undefined, returns final answer)
    expect(callCount).toBe(4)
  })

  it('does not inject prior action history into ordinary follow-up turns', async () => {
    vi.spyOn(ToolRegistry.file_read, 'execute').mockResolvedValue({
      resultForModel: 'File content already read before the API failure.',
      resultForUi: {
        title: 'Read file',
        summary: 'File content already read before the API failure.'
      }
    })

    let firstRunCallCount = 0
    vi.mocked(callModel).mockImplementation(async () => {
      firstRunCallCount++
      if (firstRunCallCount === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-read-before-failure',
              type: 'function',
              function: {
                name: 'file_read',
                arguments: JSON.stringify({ path: 'src/main/index.ts' })
              }
            }
          ]
        }
      }
      throw new Error('API unavailable')
    })

    await runAgentLoop(mockWindow, 'resume-run-1', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Read files and edit the app' }],
      sessionId: 'resume-session'
    })

    let sawCleanFollowUpContext = false
    vi.mocked(callModel).mockImplementation(async (_options, messages) => {
      const joined = messages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n')

      expect(joined).not.toContain('[RESUME CONTEXT]')
      expect(joined).not.toContain('tc-read-before-failure')
      expect(joined).not.toContain('File content already read before the API failure.')
      expect(joined).toContain('list_past_actions')
      sawCleanFollowUpContext = true

      return {
        role: 'assistant',
        content: 'Followed up without inline action history.'
      }
    })

    await runAgentLoop(mockWindow, 'resume-run-2', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: '继续' }],
      sessionId: 'resume-session'
    })

    expect(sawCleanFollowUpContext).toBe(true)
  })

  it('resumes from the last persisted checkpoint without adding a continue user message', async () => {
    vi.spyOn(ToolRegistry.file_read, 'execute').mockResolvedValue({
      resultForModel: 'Checkpoint file content from the previous successful tool call.',
      resultForUi: {
        title: 'Read file',
        summary: 'Checkpoint file content from the previous successful tool call.'
      }
    })

    let firstRunCallCount = 0
    vi.mocked(callModel).mockImplementation(async () => {
      firstRunCallCount++
      if (firstRunCallCount === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-checkpoint-read',
              type: 'function',
              function: {
                name: 'file_read',
                arguments: JSON.stringify({ path: 'src/main/index.ts' })
              }
            }
          ]
        }
      }
      throw new Error('API unavailable after tool success')
    })

    await runAgentLoop(mockWindow, 'checkpoint-run-1', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Read the project then edit it' }],
      sessionId: 'checkpoint-session'
    })

    let sawCheckpoint = false
    vi.mocked(callModel).mockImplementation(async (_options, messages) => {
      const joined = messages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n')

      expect(joined).toContain('[RESUME MODE]')
      expect(joined).toContain('Read the project then edit it')
      expect(joined).toContain('Checkpoint file content from the previous successful tool call.')
      expect(joined).not.toContain('继续')
      expect(
        messages.some((m) => m.role === 'tool' && m.tool_call_id === 'tc-checkpoint-read')
      ).toBe(true)
      sawCheckpoint = true

      return {
        role: 'assistant',
        content: 'Resumed from checkpoint.'
      }
    })

    await runAgentLoop(mockWindow, 'checkpoint-run-2', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'this should be ignored in resume mode' }],
      sessionId: 'checkpoint-session',
      resumeFromRunId: 'checkpoint-run-1'
    })

    expect(sawCheckpoint).toBe(true)
  })

  it('records interrupted shell execution as ambiguous instead of safe-to-repeat error', async () => {
    vi.spyOn(globalPermissionManager, 'requestPermission').mockResolvedValue(true)
    vi.spyOn(ToolRegistry.shell, 'execute').mockImplementation(async (_args, ctx) => {
      abortRun(ctx.reqId)
      throw new Error('Agent execution aborted by user.')
    })

    vi.mocked(callModel).mockResolvedValue({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'tc-shell-ambiguous',
          type: 'function',
          function: {
            name: 'shell',
            arguments: JSON.stringify({ command: 'npm install example-package' })
          }
        }
      ]
    })

    await runAgentLoop(mockWindow, 'ambiguous-run-1', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Install something' }],
      sessionId: 'ambiguous-session'
    })

    const record = new ActionLog(getActionLogPath('ambiguous-session')).get('tc-shell-ambiguous')
    expect(record?.resultStatus).toBe('ambiguous')
    expect(record?.resultSummary).toContain('inspect state before repeating')

    const manifest = loadRunManifest('ambiguous-session', 'ambiguous-run-1')
    expect(manifest?.status).toBe('cancelled')
    expect(manifest?.actionCallIds).toContain('tc-shell-ambiguous')
    expect(manifest?.sideEffects[0]).toMatchObject({
      actionId: 'tc-shell-ambiguous',
      toolName: 'shell',
      kind: 'shell',
      reversibility: 'ambiguous',
      status: 'ambiguous'
    })
  })

  it('records run manifest source ids and successful actions', async () => {
    vi.spyOn(ToolRegistry.file_read, 'execute').mockResolvedValue({
      resultForModel: 'Read manifest file content.',
      resultForUi: { title: 'Read file', summary: 'Read manifest file content.' }
    })

    let callCount = 0
    vi.mocked(callModel).mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-manifest-read',
              type: 'function',
              function: {
                name: 'file_read',
                arguments: JSON.stringify({ path: 'src/main/index.ts' })
              }
            }
          ]
        }
      }
      return { role: 'assistant', content: 'done' }
    })

    await runAgentLoop(mockWindow, 'manifest-run-1', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Read one file' }],
      sessionId: 'manifest-session',
      sourceMessageId: 'user-msg-1',
      assistantMessageId: 'assistant-msg-1'
    })

    const manifest = loadRunManifest('manifest-session', 'manifest-run-1')
    expect(manifest?.status).toBe('completed')
    expect(manifest?.sourceMessageId).toBe('user-msg-1')
    expect(manifest?.assistantMessageId).toBe('assistant-msg-1')
    expect(manifest?.createdMessageIds).toEqual(['user-msg-1', 'assistant-msg-1'])
    expect(manifest?.actionCallIds).toContain('tc-manifest-read')
    expect(manifest?.checkpointIds).toContain('manifest-run-1')
    expect(manifest?.sideEffects[0]).toMatchObject({
      actionId: 'tc-manifest-read',
      kind: 'read',
      reversibility: 'metadata_only',
      status: 'success'
    })
  })

  it('fetch_url=ask triggers permission request and executes if approved', async () => {
    let callCount = 0
    const permissionSpy = vi
      .spyOn(globalPermissionManager, 'requestPermission')
      .mockResolvedValue(true)

    vi.mocked(callModel).mockImplementation(async (options, messages) => {
      void options
      callCount++
      if (callCount === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-search',
              type: 'function',
              function: { name: 'search_tools', arguments: JSON.stringify({ query: 'web' }) }
            }
          ]
        }
      }
      if (callCount === 2) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-fetch',
              type: 'function',
              function: {
                name: 'fetch_url',
                arguments: JSON.stringify({ url: 'https://example.com' })
              }
            }
          ]
        }
      }
      if (callCount === 3) {
        const lastMsg = messages[messages.length - 1]
        expect(lastMsg.role).toBe('tool')
        expect(lastMsg.content).toBe('Fetched page content')
        return {
          role: 'assistant',
          content: 'Fetched successfully.'
        }
      }
      return { role: 'assistant', content: 'done' }
    })

    await runAgentLoop(
      mockWindow,
      'test-req-fetch-ask',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Fetch something' }]
      },
      {
        fetch_url: 'ask'
      }
    )

    expect(permissionSpy).toHaveBeenCalled()
    expect(callCount).toBe(3)
  })

  it('allows fetch_url continuation for the same URL when offset changes', async () => {
    let callCount = 0
    vi.mocked(callModel).mockImplementation(async (options, messages) => {
      void options
      callCount++
      if (callCount === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-search',
              type: 'function',
              function: { name: 'search_tools', arguments: JSON.stringify({ query: 'web' }) }
            }
          ]
        }
      }
      if (callCount === 2) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-fetch-1',
              type: 'function',
              function: {
                name: 'fetch_url',
                arguments: JSON.stringify({ url: 'https://example.com/paper', offset: 0 })
              }
            }
          ]
        }
      }
      if (callCount === 3) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-fetch-2',
              type: 'function',
              function: {
                name: 'fetch_url',
                arguments: JSON.stringify({ url: 'https://example.com/paper', offset: 10000 })
              }
            }
          ]
        }
      }
      const lastMsg = messages[messages.length - 1]
      expect(lastMsg.role).toBe('tool')
      expect(lastMsg.content).toBe('Fetched page content')
      return {
        role: 'assistant',
        content: 'Read two windows.'
      }
    })

    await runAgentLoop(
      mockWindow,
      'test-req-fetch-continuation',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Read this long paper' }]
      },
      {
        fetch_url: 'allow'
      }
    )

    expect(ToolRegistry.fetch_url.execute).toHaveBeenCalledTimes(2)
    expect(callCount).toBe(4)
  })

  it('fetch_url is limited to MAX_FETCH_URLS_PER_RUN = 10', async () => {
    let callCount = 0
    vi.mocked(callModel).mockImplementation(async (options, messages) => {
      void options
      callCount++
      if (callCount === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-search',
              type: 'function',
              function: { name: 'search_tools', arguments: JSON.stringify({ query: 'web' }) }
            }
          ]
        }
      }
      if (callCount >= 2 && callCount <= 12) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: `tc-fetch-${callCount}`,
              type: 'function',
              function: {
                name: 'fetch_url',
                arguments: JSON.stringify({ url: `https://example.com/p${callCount}` })
              }
            }
          ]
        }
      }
      // On the 13th call, check if the last message (from the 11th fetch_url attempt)
      // contains the limit warning content.
      const lastMsg = messages[messages.length - 1]
      expect(lastMsg.role).toBe('tool')
      expect(lastMsg.content).toContain(
        'Warning: You have reached the maximum fetch limit of 10 page windows'
      )
      return {
        role: 'assistant',
        content: 'I reached the limit and summarized.'
      }
    })

    await runAgentLoop(
      mockWindow,
      'test-req-fetch-limit',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Fetch many things' }]
      },
      {
        fetch_url: 'allow'
      }
    )

    expect(callCount).toBe(13)
  })

  it('loop guard blocks a 3rd identical tool call and stops executing it', async () => {
    let callCount = 0
    vi.mocked(callModel).mockImplementation(async (options, messages) => {
      void options
      void messages
      callCount++
      if (callCount === 1) {
        // Discover + activate web_search
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-search-tools',
              type: 'function',
              function: { name: 'search_tools', arguments: JSON.stringify({ query: 'web' }) }
            }
          ]
        }
      }
      if (callCount >= 2 && callCount <= 4) {
        // Call web_search with identical arguments three times in a row
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: `tc-ws-${callCount}`,
              type: 'function',
              function: { name: 'web_search', arguments: JSON.stringify({ query: 'same query' }) }
            }
          ]
        }
      }
      // After the 3rd identical call the loop guard should have blocked execution
      const lastMsg = messages[messages.length - 1]
      expect(lastMsg.role).toBe('tool')
      expect(lastMsg.content).toContain('Loop guard')
      return { role: 'assistant', content: 'Stopping the repeated search.' }
    })

    await runAgentLoop(mockWindow, 'test-req-loopguard', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Search repeatedly' }]
    })

    // search_tools (1) executed, web_search executed on the 2nd and 3rd model turns,
    // blocked on the 4th, then a final answer turn — execute called exactly twice.
    expect(ToolRegistry.web_search.execute).toHaveBeenCalledTimes(2)
    expect(callCount).toBe(5)
  })

  it('guardrail blocks a workspace-escaping file_write before it executes', async () => {
    const writeSpy = vi.spyOn(ToolRegistry.file_write, 'execute')
    const permissionSpy = vi
      .spyOn(globalPermissionManager, 'requestPermission')
      .mockResolvedValue(false)

    let callCount = 0
    vi.mocked(callModel).mockImplementation(async (options, messages) => {
      void options
      callCount++
      if (callCount === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-write',
              type: 'function',
              function: {
                name: 'file_write',
                arguments: JSON.stringify({ path: '../../etc/evil', content: 'x' })
              }
            }
          ]
        }
      }
      const lastMsg = messages[messages.length - 1]
      expect(lastMsg.role).toBe('tool')
      expect(lastMsg.content).toContain('denied by user')
      return { role: 'assistant', content: 'I will not write outside the workspace.' }
    })

    // Static skill grants file_write and the policy ALLOWS it — only the guardrail should stop it.
    await runAgentLoop(
      mockWindow,
      'test-req-guardrail',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        skill: {
          id: 'writer-skill',
          name: 'Writer',
          trigger: 'write',
          prompt: 'write things',
          tools: ['file_write'],
          maxSteps: 5
        },
        userInput: 'Write a file outside the workspace'
      },
      { file_write: 'allow' }
    )

    expect(permissionSpy).toHaveBeenCalled()
    expect(writeSpy).not.toHaveBeenCalled()
    expect(callCount).toBe(2)
  })

  it('emits agent_progress and agent_end completed events on normal run', async () => {
    vi.mocked(callModel).mockResolvedValue({
      role: 'assistant',
      content: 'Final Answer'
    })

    await runAgentLoop(mockWindow, 'test-req-progress-completed', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Hello' }]
    })

    expect(sendMock).toHaveBeenCalledWith('chat-chunk', {
      reqId: 'test-req-progress-completed',
      event: expect.objectContaining({ type: 'agent_start' })
    })
    expect(sendMock).toHaveBeenCalledWith('chat-chunk', {
      reqId: 'test-req-progress-completed',
      event: expect.objectContaining({ type: 'agent_progress', step: 1 })
    })
    expect(sendMock).toHaveBeenCalledWith('chat-chunk', {
      reqId: 'test-req-progress-completed',
      event: { type: 'agent_end', status: 'completed' }
    })
  })

  it('emits one agent_step for a model turn with multiple tool calls', async () => {
    let callCount = 0
    vi.mocked(callModel).mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return {
          role: 'assistant',
          content: 'I will search and fetch the relevant source first.',
          tool_calls: [
            {
              id: 'tc-search',
              type: 'function',
              function: { name: 'web_search', arguments: JSON.stringify({ query: 'quickai' }) }
            },
            {
              id: 'tc-fetch',
              type: 'function',
              function: { name: 'fetch_url', arguments: JSON.stringify({ url: 'https://example.com' }) }
            }
          ]
        }
      }
      return { role: 'assistant', content: 'Done.' }
    })

    await runAgentLoop(mockWindow, 'test-req-agent-step', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Find source' }]
    })

    const events = sendMock.mock.calls
      .map(([, payload]) => payload.event)
      .filter(Boolean)
    const stepEvents = events.filter((event) => event.type === 'agent_step')
    const toolCallEvents = events.filter((event) => event.type === 'tool_call')
    const finalEvents = events.filter((event) => event.type === 'final')

    expect(stepEvents).toHaveLength(1)
    expect(stepEvents[0]).toMatchObject({
      type: 'agent_step',
      stepId: 'test-req-agent-step:step:1',
      message: 'I will search and fetch the relevant source first.'
    })
    expect(toolCallEvents).toHaveLength(2)
    expect(toolCallEvents.every((event) => event.stepId === stepEvents[0].stepId)).toBe(true)
    expect(finalEvents).toEqual([
      {
        type: 'final',
        content: 'Done.',
        step: 2,
        stepId: 'test-req-agent-step:step:2'
      }
    ])
  })

  it('does not create an agent_step for a final-only answer', async () => {
    vi.mocked(callModel).mockResolvedValue({
      role: 'assistant',
      content: 'Final only.'
    })

    await runAgentLoop(mockWindow, 'test-req-final-only', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Hello' }]
    })

    const events = sendMock.mock.calls
      .map(([, payload]) => payload.event)
      .filter(Boolean)

    expect(events.some((event) => event.type === 'agent_step')).toBe(false)
    expect(events).toContainEqual({
      type: 'final',
      content: 'Final only.',
      step: 1,
      stepId: 'test-req-final-only:step:1'
    })
  })

  it('streams unclassified model text before committing it as final', async () => {
    vi.mocked(callModel).mockImplementation(
      async (_options, _messages, _tools, _signal, callbacks) => {
        callbacks?.onFinalChunk('Final ')
        callbacks?.onFinalChunk('answer.')
        return {
          role: 'assistant',
          content: 'Final answer.'
        }
      }
    )

    await runAgentLoop(mockWindow, 'test-req-stream-final', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Hello' }]
    })

    const events = sendMock.mock.calls
      .map(([, payload]) => payload.event)
      .filter(Boolean)

    expect(events.filter((event) => event.type === 'agent_message_delta')).toEqual([
      {
        type: 'agent_message_delta',
        content: 'Final ',
        step: 1,
        stepId: 'test-req-stream-final:step:1'
      },
      {
        type: 'agent_message_delta',
        content: 'answer.',
        step: 1,
        stepId: 'test-req-stream-final:step:1'
      }
    ])
    expect(events).toContainEqual({
      type: 'final',
      content: 'Final answer.',
      step: 1,
      stepId: 'test-req-stream-final:step:1'
    })
  })

  it('emits agent_end max_steps on maxSteps exhaustion', async () => {
    let callCount = 0
    vi.mocked(callModel).mockImplementation(async () => {
      callCount++
      if (callCount <= 2) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: `tc-${callCount}`,
              type: 'function',
              function: { name: 'search_tools', arguments: JSON.stringify({ query: 'web' }) }
            }
          ]
        }
      }
      return {
        role: 'assistant',
        content: 'Max steps final response.'
      }
    })

    await runAgentLoop(mockWindow, 'test-req-max-steps-event', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      skill: {
        id: 'test-skill',
        name: 'Test Skill',
        trigger: 'test',
        prompt: 'test prompt',
        maxSteps: 2
      },
      userInput: 'Run test skill'
    })

    expect(sendMock).toHaveBeenCalledWith('chat-chunk', {
      reqId: 'test-req-max-steps-event',
      event: { type: 'agent_end', status: 'max_steps' }
    })
  })

  it('emits agent_end failed on unexpected error', async () => {
    vi.mocked(callModel).mockRejectedValue(new Error('Model API is down'))

    await runAgentLoop(mockWindow, 'test-req-failed-event', {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Hello' }]
    })

    expect(sendMock).toHaveBeenCalledWith('chat-chunk', {
      reqId: 'test-req-failed-event',
      error: 'Model API is down'
    })
    expect(sendMock).toHaveBeenCalledWith('chat-chunk', {
      reqId: 'test-req-failed-event',
      event: { type: 'agent_end', status: 'failed', error: 'Model API is down' }
    })
  })

  it('rejects pending permission and emits cancelled when aborted', async () => {
    vi.mocked(callModel).mockResolvedValue({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'tc-abort',
          type: 'function',
          function: { name: 'web_search', arguments: JSON.stringify({ query: 'test' }) }
        }
      ]
    })

    const permPromise = vi
      .spyOn(globalPermissionManager, 'requestPermission')
      .mockImplementation(async (reqId) => {
        abortRun(reqId)
        throw new Error('Agent run terminated or aborted.')
      })

    await runAgentLoop(
      mockWindow,
      'test-req-abort-event',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        skill: {
          id: 'test-skill-abort',
          name: 'Test Skill Abort',
          trigger: 'test',
          prompt: 'test prompt',
          tools: ['web_search'],
          maxSteps: 5
        },
        userInput: 'Abort test'
      },
      {
        web_search: 'ask'
      }
    )

    expect(sendMock).toHaveBeenCalledWith('chat-chunk', {
      reqId: 'test-req-abort-event',
      event: { type: 'agent_end', status: 'cancelled' }
    })

    expect(sendMock).toHaveBeenCalledWith('chat-chunk', {
      reqId: 'test-req-abort-event',
      cancelled: true,
      done: true,
      tokenSpeed: expect.any(Number)
    })

    permPromise.mockRestore()
  })

  it('shell=ask bypasses permission prompt if prefix is approved in runCtx', async () => {
    vi.spyOn(ToolRegistry.shell, 'execute').mockResolvedValue({
      resultForModel: 'command output',
      resultForUi: { title: 'git status', summary: 'success' }
    })

    const permissionSpy = vi
      .spyOn(globalPermissionManager, 'requestPermission')
      .mockResolvedValue(true)

    let callCount = 0
    vi.mocked(callModel).mockImplementation(async (options, messages, tools) => {
      void options
      void messages
      void tools
      callCount++
      if (callCount === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-shell-git-1',
              type: 'function',
              function: { name: 'shell', arguments: JSON.stringify({ command: 'git status' }) }
            }
          ]
        }
      }
      if (callCount === 2) {
        const { resolveToolPermission } = await import('./index')
        resolveToolPermission('test-req-shell-prefix', 'tc-shell-git-1', {
          approved: true,
          scope: 'prefix',
          prefix: 'git'
        })

        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-shell-git-2',
              type: 'function',
              function: { name: 'shell', arguments: JSON.stringify({ command: 'git diff' }) }
            }
          ]
        }
      }
      if (callCount === 3) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-shell-npm',
              type: 'function',
              function: { name: 'shell', arguments: JSON.stringify({ command: 'npm install' }) }
            }
          ]
        }
      }
      if (callCount === 4) {
        return { role: 'assistant', content: 'Done.' }
      }
      return { role: 'assistant', content: 'done' }
    })

    await runAgentLoop(
      mockWindow,
      'test-req-shell-prefix',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Run git commands' }]
      },
      {
        shell: 'ask'
      }
    )

    expect(permissionSpy).toHaveBeenCalledTimes(2)
    const calledCallIds = permissionSpy.mock.calls.map((c) => c[1])
    expect(calledCallIds).toContain('tc-shell-git-1')
    expect(calledCallIds).toContain('tc-shell-npm')
    expect(calledCallIds).not.toContain('tc-shell-git-2')
  })

  it('any_tool=ask bypasses permission prompt if tool itself is approved in runCtx', async () => {
    vi.spyOn(ToolRegistry.file_read, 'execute').mockResolvedValue({
      resultForModel: 'file data',
      resultForUi: { title: 'file_read', summary: 'success' }
    })

    const permissionSpy = vi
      .spyOn(globalPermissionManager, 'requestPermission')
      .mockResolvedValue(true)

    let callCount = 0
    vi.mocked(callModel).mockImplementation(async (options, messages, tools) => {
      void options
      void messages
      void tools
      callCount++
      if (callCount === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-read-file-1',
              type: 'function',
              function: { name: 'file_read', arguments: JSON.stringify({ path: 'a.txt' }) }
            }
          ]
        }
      }
      if (callCount === 2) {
        const { resolveToolPermission } = await import('./index')
        resolveToolPermission('test-req-tool-delegation', 'tc-read-file-1', {
          approved: true,
          scope: 'tool',
          tool: 'file_read'
        })

        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-read-file-2',
              type: 'function',
              function: { name: 'file_read', arguments: JSON.stringify({ path: 'b.txt' }) }
            }
          ]
        }
      }
      if (callCount === 3) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-search',
              type: 'function',
              function: { name: 'web_search', arguments: JSON.stringify({ query: 'test' }) }
            }
          ]
        }
      }
      if (callCount === 4) {
        return { role: 'assistant', content: 'Done.' }
      }
      return { role: 'assistant', content: 'done' }
    })

    await runAgentLoop(
      mockWindow,
      'test-req-tool-delegation',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Read files' }]
      },
      {
        file_read: 'ask',
        web_search: 'ask'
      }
    )

    expect(permissionSpy).toHaveBeenCalledTimes(2)
    const calledCallIds = permissionSpy.mock.calls.map((c) => c[1])
    expect(calledCallIds).toContain('tc-read-file-1')
    expect(calledCallIds).toContain('tc-search')
    expect(calledCallIds).not.toContain('tc-read-file-2')
  })

  it('askCalls loop bypasses subsequent prompts in the same turn once tool/prefix is approved', async () => {
    vi.spyOn(ToolRegistry.file_read, 'execute').mockResolvedValue({
      resultForModel: 'file data',
      resultForUi: { title: 'file_read', summary: 'success' }
    })

    const permissionSpy = vi
      .spyOn(globalPermissionManager, 'requestPermission')
      .mockImplementation(async (reqId, callId) => {
        const { resolveToolPermission } = await import('./index')
        resolveToolPermission(reqId, callId, {
          approved: true,
          scope: 'tool',
          tool: 'file_read'
        })
        return true
      })

    let callCount = 0
    vi.mocked(callModel).mockImplementation(async (options, messages, tools) => {
      void options
      void messages
      void tools
      callCount++
      if (callCount === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-p-read-1',
              type: 'function',
              function: { name: 'file_read', arguments: JSON.stringify({ path: 'a.txt' }) }
            },
            {
              id: 'tc-p-read-2',
              type: 'function',
              function: { name: 'file_read', arguments: JSON.stringify({ path: 'b.txt' }) }
            },
            {
              id: 'tc-p-read-3',
              type: 'function',
              function: { name: 'file_read', arguments: JSON.stringify({ path: 'c.txt' }) }
            }
          ]
        }
      }
      if (callCount === 2) {
        return { role: 'assistant', content: 'Done.' }
      }
      return { role: 'assistant', content: 'done' }
    })

    await runAgentLoop(
      mockWindow,
      'test-req-parallel-delegation',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Read files in parallel' }]
      },
      {
        file_read: 'ask'
      }
    )

    expect(permissionSpy).toHaveBeenCalledTimes(1)
    expect(permissionSpy.mock.calls[0][1]).toBe('tc-p-read-1')
  })

  it('an approved shell prefix does NOT cover a chained command — it re-prompts', async () => {
    vi.spyOn(ToolRegistry.shell, 'execute').mockResolvedValue({
      resultForModel: 'command output',
      resultForUi: { title: 'shell', summary: 'success' }
    })

    const permissionSpy = vi
      .spyOn(globalPermissionManager, 'requestPermission')
      .mockResolvedValue(true)

    let callCount = 0
    vi.mocked(callModel).mockImplementation(async (options, messages, tools) => {
      void options
      void messages
      void tools
      callCount++
      if (callCount === 1) {
        // First call: a plain `git status` that the user approves with prefix scope.
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-chain-git-1',
              type: 'function',
              function: { name: 'shell', arguments: JSON.stringify({ command: 'git status' }) }
            }
          ]
        }
      }
      if (callCount === 2) {
        const { resolveToolPermission } = await import('./index')
        resolveToolPermission('test-req-shell-chain', 'tc-chain-git-1', {
          approved: true,
          scope: 'prefix',
          prefix: 'git'
        })
        // Now a chained command whose head matches the approved `git` prefix but smuggles a
        // destructive tail. It must NOT ride the approval — a fresh prompt is required.
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-chain-git-2',
              type: 'function',
              function: {
                name: 'shell',
                arguments: JSON.stringify({ command: 'git log && rm -rf node_modules' })
              }
            }
          ]
        }
      }
      if (callCount === 3) {
        return { role: 'assistant', content: 'Done.' }
      }
      return { role: 'assistant', content: 'done' }
    })

    await runAgentLoop(
      mockWindow,
      'test-req-shell-chain',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Run git commands' }]
      },
      {
        shell: 'ask'
      }
    )

    // Both shell calls must hit the permission prompt: the chained one is not covered by the
    // approved prefix.
    expect(permissionSpy).toHaveBeenCalledTimes(2)
    const calledCallIds = permissionSpy.mock.calls.map((c) => c[1])
    expect(calledCallIds).toContain('tc-chain-git-1')
    expect(calledCallIds).toContain('tc-chain-git-2')
  })
})
