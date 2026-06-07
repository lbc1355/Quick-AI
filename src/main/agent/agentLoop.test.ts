import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest'
import { runAgentLoop } from './agentLoop'
import { callModel } from './callModel'
import { ToolRegistry } from '../toolRegistry'
import { globalPermissionManager } from './permissionManager'
import { BrowserWindow } from 'electron'
import { abortRun } from './AgentRunContext'

vi.mock('electron', () => ({
  BrowserWindow: {}
}))

vi.mock('./callModel', () => ({
  callModel: vi.fn()
}))

describe('runAgentLoop', () => {
  let mockWindow: BrowserWindow
  let sendMock: Mock

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('unactivated tool is not declared and returns error on execution attempt', async () => {
    let callCount = 0
    vi.mocked(callModel).mockImplementation(async (options, messages, tools) => {
      void options
      callCount++
      if (callCount === 1) {
        // First turn: declare only search_tools (dynamic mode default)
        expect(tools?.map((t) => t.function.name)).toEqual(['search_tools'])
        // Model tries to call fetch_url (which is not active yet)
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tc-unactive',
              type: 'function',
              function: {
                name: 'fetch_url',
                arguments: JSON.stringify({ url: 'https://example.com' })
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
        // search_tools should be declared, but web_search should NOT be because it is denied in policy
        expect(tools?.map((t) => t.function.name)).toEqual(['search_tools'])
        // Try calling it anyway
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

    const permPromise = vi.spyOn(globalPermissionManager, 'requestPermission').mockImplementation(async (reqId) => {
      abortRun(reqId)
      throw new Error('Agent run terminated or aborted.')
    })

    await runAgentLoop(mockWindow, 'test-req-abort-event', {
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
    }, {
      web_search: 'ask'
    })

    expect(sendMock).toHaveBeenCalledWith('chat-chunk', {
      reqId: 'test-req-abort-event',
      event: { type: 'agent_end', status: 'cancelled' }
    })

    permPromise.mockRestore()
  })
})
