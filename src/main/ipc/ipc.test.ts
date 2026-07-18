import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron'

const mockHandlers: Record<string, (...args: unknown[]) => unknown> = {}
const mockListeners: Record<string, (...args: unknown[]) => unknown> = {}
const mockWebContentsSend = vi.hoisted(() => vi.fn())
const promptStoreMocks = vi.hoisted(() => ({
  admitSessionPrompt: vi.fn(),
  cancelSessionPrompt: vi.fn(),
  claimNextSessionPrompt: vi.fn(),
  completeSessionPrompt: vi.fn(),
  finishSessionPrompt: vi.fn(),
  getSessionPrompt: vi.fn(),
  listSessionPrompts: vi.fn(),
  markSessionPromptRunning: vi.fn(),
  requeueSessionPrompts: vi.fn()
}))

vi.mock('electron', () => {
  return {
    ipcMain: {
      handle: vi.fn((channel, handler) => {
        mockHandlers[channel] = handler
      }),
      on: vi.fn((channel, listener) => {
        mockListeners[channel] = listener
      })
    },
    dialog: {
      showOpenDialog: vi.fn()
    },
    BrowserWindow: {
      fromWebContents: vi.fn().mockReturnValue({
        isDestroyed: () => false,
        webContents: { send: mockWebContentsSend }
      } as unknown)
    }
  }
})

vi.mock('../aiClient', () => ({
  handleChatCompletion: vi.fn(),
  fetchModels: vi.fn(),
  abortChatCompletion: vi.fn()
}))

vi.mock('../agent', () => ({
  runGeneralAgent: vi.fn(),
  runAgentSkill: vi.fn(),
  resolveToolPermission: vi.fn(),
  resolveUserChoice: vi.fn(),
  abortAgentSkill: vi.fn()
}))

vi.mock('../toolRegistry', () => ({
  getToolRegistryView: vi.fn().mockReturnValue({
    list: vi.fn().mockReturnValue([
      {
        name: 'tool1',
        title: 'T1',
        description: 'D1',
        category: 'file',
        risk: 'low',
        implemented: true,
        discoverable: true,
        parameters: {}
      }
    ])
  })
}))

vi.mock('../database/sessionPromptStore', () => promptStoreMocks)

import { registerStoreIpc } from './storeIpc'
import { registerMcpIpc } from './mcpIpc'
import { registerMemoryIpc } from './memoryIpc'
import { registerCacheIpc } from './cacheIpc'
import { registerWindowIpc } from './windowIpc'
import { registerProjectIpc } from './projectIpc'
import { registerBackgroundShellIpc } from './backgroundShellIpc'
import { registerGenerationIpc } from './generationIpc'
import type { FileStore } from '../store'

// Import mocks to assert on them
import { handleChatCompletion, fetchModels, abortChatCompletion } from '../aiClient'
import {
  runGeneralAgent,
  runAgentSkill,
  resolveToolPermission,
  resolveUserChoice,
  abortAgentSkill
} from '../agent'
import { globalSessionCoordinator } from '../sessionCoordinator'

describe('IPC Registration Modules', () => {
  beforeEach(() => {
    // Clear registration records
    for (const key of Object.keys(mockHandlers)) delete mockHandlers[key]
    for (const key of Object.keys(mockListeners)) delete mockListeners[key]
    vi.clearAllMocks()
    promptStoreMocks.listSessionPrompts.mockReturnValue([])
    promptStoreMocks.markSessionPromptRunning.mockReturnValue(true)
    promptStoreMocks.requeueSessionPrompts.mockReturnValue(0)
  })

  it('registerStoreIpc binds correct store-get and store-set behaviors', () => {
    const mockStore = {
      get: vi.fn().mockReturnValue('mockValue'),
      set: vi.fn(),
      getStorePath: vi.fn().mockReturnValue('/mock/path')
    } as unknown as FileStore

    const onSkillsUpdated = vi.fn()

    registerStoreIpc(mockStore, onSkillsUpdated)

    expect(mockHandlers['store-get']).toBeDefined()
    expect(mockHandlers['store-set']).toBeDefined()
    expect(mockHandlers['get-app-info']).toBeDefined()

    // Test store-get
    const getResult = mockHandlers['store-get']({} as IpcMainInvokeEvent, 'settings')
    expect(getResult).toBe('mockValue')
    expect(mockStore.get).toHaveBeenCalledWith('settings')

    // Test forbidden store-get key
    expect(() => mockHandlers['store-get']({} as IpcMainInvokeEvent, 'forbiddenKey')).toThrow()

    // Test store-set
    mockHandlers['store-set']({} as IpcMainInvokeEvent, 'settings', 'newValue')
    expect(mockStore.set).toHaveBeenCalledWith('settings', 'newValue')

    // Test skills callback trigger
    mockHandlers['store-set']({} as IpcMainInvokeEvent, 'skills', [])
    expect(onSkillsUpdated).toHaveBeenCalled()
  })

  it('registerMcpIpc registers config and status channels', () => {
    registerMcpIpc()
    expect(mockHandlers['mcp-get-config']).toBeDefined()
    expect(mockHandlers['mcp-set-config']).toBeDefined()
    expect(mockHandlers['mcp-delete-server']).toBeDefined()
    expect(mockHandlers['mcp-get-status']).toBeDefined()
    expect(mockHandlers['mcp-open-config']).toBeDefined()
  })

  it('registerMemoryIpc registers memory entries channels', () => {
    registerMemoryIpc()
    expect(mockHandlers['memory-entries']).toBeDefined()
    expect(mockHandlers['memory-entry-read']).toBeDefined()
    expect(mockHandlers['memory-entry-write']).toBeDefined()
  })

  it('registerCacheIpc registers session cache cleanup and compaction channels', () => {
    registerCacheIpc()
    expect(mockHandlers['clear-session-caches']).toBeDefined()
    expect(mockHandlers['fork-session-caches']).toBeDefined()
    expect(mockHandlers['compact-context']).toBeDefined()
  })

  it('registerBackgroundShellIpc registers background shell management channels', () => {
    registerBackgroundShellIpc()
    expect(mockHandlers['bg-shell-list']).toBeDefined()
    expect(mockHandlers['bg-shell-read-log']).toBeDefined()
    expect(mockHandlers['bg-shell-stop']).toBeDefined()
  })

  it('registerWindowIpc routes actions to WindowController', () => {
    const mockController = {
      hideWindow: vi.fn(),
      showWindow: vi.fn(),
      minimizeWindow: vi.fn(),
      toggleWindowMaximized: vi.fn(),
      getCurrentWindowState: vi.fn().mockReturnValue({ mode: 'window', isMaximized: false }),
      setWindowMode: vi.fn(),
      setFilePickerActive: vi.fn(),
      setWindowPinned: vi.fn(),
      toggleDevTools: vi.fn(),
      reSummonWindow: vi.fn(),
      getMainWindow: vi.fn()
    }

    registerWindowIpc(mockController)

    expect(mockListeners['hide-window']).toBeDefined()
    expect(mockHandlers['get-window-state']).toBeDefined()
    expect(mockHandlers['set-window-mode']).toBeDefined()

    mockListeners['hide-window']({} as IpcMainEvent)
    expect(mockController.hideWindow).toHaveBeenCalled()

    mockHandlers['get-window-state']({} as IpcMainInvokeEvent)
    expect(mockController.getCurrentWindowState).toHaveBeenCalled()
  })

  it('registerProjectIpc routes directory selection via WindowController', async () => {
    const mockController = {
      hideWindow: vi.fn(),
      showWindow: vi.fn(),
      minimizeWindow: vi.fn(),
      toggleWindowMaximized: vi.fn(),
      getCurrentWindowState: vi.fn(),
      setWindowMode: vi.fn(),
      setFilePickerActive: vi.fn(),
      setWindowPinned: vi.fn(),
      toggleDevTools: vi.fn(),
      reSummonWindow: vi.fn(),
      getMainWindow: vi.fn().mockReturnValue({} as unknown)
    }

    registerProjectIpc(mockController)

    expect(mockHandlers['select-project-directory']).toBeDefined()
  })

  it('registerGenerationIpc binds generation, skill and abort channels', () => {
    const mockStore = {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'settings') {
          return {
            permissions: {},
            systemPrompt: 'sys-prompt'
          }
        }
        return null
      })
    } as unknown as FileStore

    registerGenerationIpc(mockStore)

    expect(mockHandlers['list-agent-tools']).toBeDefined()
    expect(mockHandlers['admit-session-prompt']).toBeDefined()
    expect(mockHandlers['list-session-prompts']).toBeDefined()
    expect(mockHandlers['claim-next-session-prompt']).toBeDefined()
    expect(mockHandlers['complete-session-prompt']).toBeDefined()
    expect(mockHandlers['cancel-session-prompt']).toBeDefined()
    expect(mockHandlers['requeue-session-prompt']).toBeDefined()
    expect(mockHandlers['fetch-models']).toBeDefined()
    expect(mockListeners['start-chat-completion']).toBeDefined()
    expect(mockListeners['start-agent-skill']).toBeDefined()
    expect(mockListeners['respond-tool-permission']).toBeDefined()
    expect(mockListeners['respond-user-choice']).toBeDefined()
    expect(mockListeners['abort-generation']).toBeDefined()

    // Test list-agent-tools
    const tools = mockHandlers['list-agent-tools']({} as IpcMainInvokeEvent)
    expect(tools).toContainEqual(expect.objectContaining({ name: 'tool1' }))

    // Test fetch-models
    mockHandlers['fetch-models']({} as IpcMainInvokeEvent, 'url', 'key')
    expect(fetchModels).toHaveBeenCalledWith('url', 'key')

    // Test start-chat-completion in chat mode
    mockListeners['start-chat-completion']({ sender: {} } as IpcMainEvent, 'req-1', {
      runMode: 'chat'
    })
    expect(handleChatCompletion).toHaveBeenCalledWith(expect.any(Object), 'req-1', {
      runMode: 'chat'
    })

    // Test start-chat-completion in agent mode
    mockListeners['start-chat-completion']({ sender: {} } as IpcMainEvent, 'req-2', {
      runMode: 'agent'
    })
    expect(runGeneralAgent).toHaveBeenCalledWith(
      expect.any(Object),
      'req-2',
      expect.objectContaining({ systemPrompt: 'sys-prompt' }),
      expect.any(Object)
    )

    // Test start-agent-skill
    mockListeners['start-agent-skill']({ sender: {} } as IpcMainEvent, 'req-3', { option: 'val' })
    expect(runAgentSkill).toHaveBeenCalledWith(
      expect.any(Object),
      'req-3',
      expect.objectContaining({ option: 'val' }),
      expect.any(Object)
    )

    // Test respond-tool-permission
    mockListeners['respond-tool-permission']({} as IpcMainEvent, 'req-4', 'call-1', true)
    expect(resolveToolPermission).toHaveBeenCalledWith('req-4', 'call-1', true)

    // Test respond-user-choice
    mockListeners['respond-user-choice']({} as IpcMainEvent, 'req-5', 'request-1', { yes: true })
    expect(resolveUserChoice).toHaveBeenCalledWith('req-5', 'request-1', { yes: true })

    // Test abort-generation
    mockListeners['abort-generation']({} as IpcMainEvent, 'req-6')
    expect(abortChatCompletion).toHaveBeenCalledWith('req-6')
    expect(abortAgentSkill).toHaveBeenCalledWith('req-6')
  })

  it('persists prompt admission and steers only an accepting agent run', async () => {
    const mockStore = {
      get: vi.fn().mockReturnValue({ permissions: {}, systemPrompt: 'sys-prompt' })
    } as unknown as FileStore
    let finishRun: (() => void) | undefined
    vi.mocked(runGeneralAgent).mockImplementation(
      async () =>
        await new Promise<void>((resolve) => {
          finishRun = resolve
        })
    )
    registerGenerationIpc(mockStore)

    mockListeners['start-chat-completion']({ sender: {} } as IpcMainEvent, 'agent-req', {
      runMode: 'agent',
      sessionId: 'session-steer'
    })

    const prompt = {
      id: 'admission-1',
      sessionId: 'session-steer',
      mode: 'steer' as const,
      status: 'pending' as const,
      runMode: 'agent' as const,
      sourceMessageId: 'message-1',
      messages: [{ role: 'user', content: 'change direction' }],
      createdAt: 1,
      updatedAt: 1
    }
    promptStoreMocks.admitSessionPrompt.mockReturnValue({ prompt, inserted: true })
    promptStoreMocks.getSessionPrompt.mockReturnValue({ ...prompt, status: 'running' })

    const result = mockHandlers['admit-session-prompt']({} as IpcMainInvokeEvent, {
      id: prompt.id,
      sessionId: prompt.sessionId,
      mode: prompt.mode,
      runMode: prompt.runMode,
      sourceMessageId: prompt.sourceMessageId,
      messages: prompt.messages
    })

    expect(result).toMatchObject({ disposition: 'steered', prompt: { status: 'running' } })
    expect(promptStoreMocks.markSessionPromptRunning).toHaveBeenCalledWith('admission-1')
    expect(globalSessionCoordinator.getActiveSession('session-steer')).toMatchObject({
      pendingSteeringCount: 1
    })

    finishRun?.()
    await vi.waitFor(() => {
      expect(promptStoreMocks.requeueSessionPrompts).toHaveBeenCalledWith(['admission-1'])
    })
  })

  it('coordinates one foreground generation per session and routes cancellation by request', async () => {
    const mockStore = {
      get: vi.fn().mockReturnValue({ permissions: {}, systemPrompt: 'sys-prompt' })
    } as unknown as FileStore
    let finishRun: (() => void) | undefined
    vi.mocked(handleChatCompletion).mockImplementation(
      async () =>
        await new Promise<void>((resolve) => {
          finishRun = resolve
        })
    )
    vi.mocked(abortChatCompletion).mockImplementation(() => finishRun?.())
    registerGenerationIpc(mockStore)

    mockListeners['start-chat-completion']({ sender: {} } as IpcMainEvent, 'req-active', {
      runMode: 'chat',
      sessionId: 'session-1'
    })
    expect(globalSessionCoordinator.getActiveSession('session-1')).toMatchObject({
      reqId: 'req-active',
      kind: 'chat'
    })

    mockListeners['start-chat-completion']({ sender: {} } as IpcMainEvent, 'req-busy', {
      runMode: 'chat',
      sessionId: 'session-1'
    })
    await vi.waitFor(() => {
      expect(mockWebContentsSend).toHaveBeenCalledWith(
        'chat-chunk',
        expect.objectContaining({
          reqId: 'req-busy',
          error: expect.stringContaining('already running request req-active')
        })
      )
    })
    expect(handleChatCompletion).toHaveBeenCalledTimes(1)

    mockListeners['abort-generation']({} as IpcMainEvent, 'req-active')
    expect(abortChatCompletion).toHaveBeenCalledWith('req-active')
    expect(abortAgentSkill).not.toHaveBeenCalledWith('req-active')
    await vi.waitFor(() => {
      expect(globalSessionCoordinator.getActiveSession('session-1')).toBeUndefined()
    })
  })
})
