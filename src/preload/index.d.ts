import { ElectronAPI } from '@electron-toolkit/preload'
import {
  StoreKey,
  StoreValue,
  AgentToolInfo,
  AgentSkillRunOptions,
  ChatChunkData,
  ChatRunOptions,
  ContextCompactionRequest,
  ContextCompactionResult,
  ClearSessionCachesPayload,
  ForkSessionCachesPayload,
  McpServerStatus,
  FetchedModelInfo,
  Project,
  Skill,
  UserChoiceRequest,
  UserChoiceResponse,
  WindowMode,
  WindowState,
  AdmitSessionPromptInput,
  AdmitSessionPromptResult,
  SessionPromptAdmission,
  AgentFileRevertPreview,
  RevertAgentFileChangesInput,
  RevertAgentFileChangesResult,
  SessionFileTransitionInput,
  SessionFileTransitionPreview,
  SessionFileTransitionResult,
  BackgroundShellResultNotification,
  BackgroundSubagentResultNotification,
  BackgroundSubagentEventNotification,
  BackgroundJobInfo,
  ProviderModelDiscoveryRequest,
  ProviderModelDiscoveryCache,
  ProviderConnectionTestResult
} from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      storeGet: <K extends StoreKey>(key: K) => Promise<StoreValue<K>>
      storeSet: <K extends StoreKey>(key: K, value: StoreValue<K>) => Promise<boolean>
      getAppInfo: () => Promise<{ storePath: string; version: string }>
      listAgentTools: () => Promise<AgentToolInfo[]>
      selectProjectDirectory: () => Promise<Pick<Project, 'name' | 'path'> | null>
      showMessageBox: (options: {
        type?: 'none' | 'info' | 'error' | 'question' | 'warning'
        title?: string
        message: string
        detail?: string
        buttons: string[]
        defaultId?: number
        cancelId?: number
      }) => Promise<number>
      hideWindow: () => void
      getWindowState: () => Promise<WindowState>
      setWindowMode: (mode: WindowMode) => Promise<WindowState>
      minimizeWindow: () => void
      toggleWindowMaximized: () => void
      toggleDevTools: () => void
      setFilePickerActive: (active: boolean) => void
      setWindowPinned: (pinned: boolean) => void
      reSummonWindow: () => void
      startChatCompletion: (reqId: string, options: ChatRunOptions) => void
      startAgentSkill: (reqId: string, options: AgentSkillRunOptions) => void
      respondToolPermission: (
        reqId: string,
        callId: string,
        approved:
          | boolean
          | {
              approved: boolean
              scope?: 'prefix' | 'tool'
              prefix?: string
              prefixes?: string[]
              tool?: string
            }
      ) => void
      respondUserChoice: (reqId: string, requestId: string, response: UserChoiceResponse) => void
      abortGeneration: (reqId: string) => void
      advanceSessionContext: (sessionId: string, contextEpoch: number) => void
      admitSessionPrompt: (input: AdmitSessionPromptInput) => Promise<AdmitSessionPromptResult>
      listSessionPrompts: (sessionId: string) => Promise<SessionPromptAdmission[]>
      claimNextSessionPrompt: (
        sessionId: string,
        contextEpoch?: number
      ) => Promise<SessionPromptAdmission | undefined>
      completeSessionPrompt: (admissionId: string) => Promise<boolean>
      cancelSessionPrompt: (admissionId: string) => Promise<boolean>
      requeueSessionPrompt: (admissionId: string) => Promise<boolean>
      compactContext: (payload: ContextCompactionRequest) => Promise<ContextCompactionResult>
      previewAgentFileRevert: (sessionId: string, runId: string) => Promise<AgentFileRevertPreview>
      revertAgentFileChanges: (
        input: RevertAgentFileChangesInput
      ) => Promise<RevertAgentFileChangesResult>
      previewSessionFileTransition: (
        input: SessionFileTransitionInput
      ) => Promise<SessionFileTransitionPreview>
      applySessionFileTransition: (
        input: SessionFileTransitionInput
      ) => Promise<SessionFileTransitionResult>
      clearSessionCaches: (payload: ClearSessionCachesPayload) => Promise<{ ok: boolean }>
      forkSessionCaches: (payload: ForkSessionCachesPayload) => Promise<{
        ok: boolean
        actions: number
        checkpoints: number
        manifests: number
        events: number
      }>
      showNotification: (title: string, body: string) => void
      onChatChunk: (callback: (data: ChatChunkData) => void) => () => void
      onBackgroundSubagentResult: (
        callback: (notification: BackgroundSubagentResultNotification) => void
      ) => () => void
      onBackgroundShellResult: (
        callback: (notification: BackgroundShellResultNotification) => void
      ) => () => void
      onBackgroundSubagentEvent: (
        callback: (notification: BackgroundSubagentEventNotification) => void
      ) => () => void
      onSkillsUpdated: (callback: (skills: Skill[]) => void) => () => void
      onWindowStateChanged: (callback: (state: WindowState) => void) => () => void
      onUserChoiceRequest: (callback: (request: UserChoiceRequest) => void) => () => void
      fetchModels: (request: ProviderModelDiscoveryRequest) => Promise<FetchedModelInfo[]>
      testProviderConnection: (
        request: ProviderModelDiscoveryRequest
      ) => Promise<ProviderConnectionTestResult>
      setProviderModelDiscoveryCache: (
        accountId: string,
        cache: ProviderModelDiscoveryCache
      ) => Promise<boolean>
      listMemoryEntries: () => Promise<Array<{ id: string; label: string; kind: string }>>
      readMemoryEntry: (id: string) => Promise<string>
      writeMemoryEntry: (id: string, content: string) => Promise<{ ok: boolean }>
      mcpGetConfig: () => Promise<string>
      mcpSetConfig: (content: string) => Promise<string>
      mcpDeleteServer: (name: string) => Promise<{ deleted: boolean; config: string }>
      mcpGetStatus: () => Promise<McpServerStatus[]>
      mcpReloadServer: (name: string) => Promise<McpServerStatus>
      mcpOpenConfig: () => Promise<void>
      backgroundJobList: (sessionId?: string) => Promise<BackgroundJobInfo[]>
      backgroundJobCancel: (id: string) => Promise<BackgroundJobInfo>
    }
  }
}
