import type {
  ChatCompletionMessage,
  ChatToolDeclaration,
  ModelRuntimeConfig,
  ModelTransportId,
  ProviderApiFormat,
  ProviderEndpointType
} from '../../shared/types'
import type { ModelEvent } from './modelEvents'

export interface CallModelOptions {
  apiUrl: string
  apiKey: string
  model: string
  providerType?: ModelRuntimeConfig['providerType']
  endpointType?: ProviderEndpointType
  modelRuntime?: ModelRuntimeConfig
  /** Canonical runtime driver. apiFormat remains supported for persisted legacy settings. */
  transportId?: ModelTransportId
  apiFormat?: ProviderApiFormat
}

export interface ToolCallStreamProgress {
  index: number
  id?: string
  toolName?: string
  argumentsLength: number
  argumentsDeltaLength: number
  generatedLineCount: number
}

export interface CallModelCallbacks {
  onReasoning: (content: string) => void
  onFinalChunk: (content: string) => void
  onToolCallProgress?: (progress: ToolCallStreamProgress) => void
  /** Canonical event stream shared by every model transport. */
  onEvent?: (event: ModelEvent) => void
}

export type ModelTransportExecutor = (
  options: CallModelOptions,
  messages: ChatCompletionMessage[],
  toolsToDeclare?: ChatToolDeclaration[],
  signal?: AbortSignal,
  callbacks?: CallModelCallbacks
) => Promise<ChatCompletionMessage>
