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

vi.mock('electron', () => ({
  BrowserWindow: {},
  app: {
    getPath: () => join(tmpdir(), 'quickai-agentloop-test')
  }
}))

vi.mock('./callModel', () => ({
  callModel: vi.fn()
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
      done: true
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
