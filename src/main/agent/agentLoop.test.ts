import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest'
import { runAgentLoop } from './agentLoop'
import { callModel } from './callModel'
import { ToolRegistry } from '../toolRegistry'
import { globalPermissionManager } from './permissionManager'
import { BrowserWindow } from 'electron'

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
})
