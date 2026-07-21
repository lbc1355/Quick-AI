import type { ModelTransportId, ProviderApiFormat } from '../../shared/types'
import { callChatCompletionsModel } from './callChatCompletionsModel'
import { callResponsesModel } from './callResponsesModel'
import type { ModelTransportExecutor } from './modelCallTypes'

export interface ModelTransport {
  id: ModelTransportId
  apiFormat: ProviderApiFormat
  execute: ModelTransportExecutor
}

const transports = new Map<ModelTransportId, ModelTransport>([
  [
    'openai-chat-completions',
    {
      id: 'openai-chat-completions',
      apiFormat: 'chat-completions',
      execute: callChatCompletionsModel
    }
  ],
  [
    'openai-responses',
    {
      id: 'openai-responses',
      apiFormat: 'responses',
      execute: callResponsesModel
    }
  ]
])

export function getModelTransport(id: ModelTransportId): ModelTransport {
  const transport = transports.get(id)
  if (!transport) throw new Error(`Unknown model transport: ${id}`)
  return transport
}

/** Extension seam for future native protocol drivers. */
export function registerModelTransport(transport: ModelTransport): () => void {
  if (transports.has(transport.id)) {
    throw new Error(`Model transport is already registered: ${transport.id}`)
  }
  transports.set(transport.id, transport)
  return () => {
    if (transports.get(transport.id) === transport) transports.delete(transport.id)
  }
}
