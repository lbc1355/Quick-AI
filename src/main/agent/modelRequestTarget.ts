import type { ResolvedProviderConnection } from '../../shared/types'

export interface ModelRequestTarget {
  url: string
  headers: Record<string, string>
}

/** OpenAI-compatible authentication shared by the built-in protocol transports. */
export function buildOpenAICompatibleRequestTarget(
  connection: ResolvedProviderConnection,
  endpointPath: string
): ModelRequestTarget {
  const baseUrl = connection.baseUrl.trim()
  if (!baseUrl) throw new Error('Provider API URL is not configured.')
  const authHeaders: Record<string, string> = {}
  if (connection.auth.type === 'bearer' && connection.auth.token) {
    authHeaders.Authorization = `Bearer ${connection.auth.token}`
  } else if (connection.auth.type === 'header' && connection.auth.value) {
    authHeaders[connection.auth.name] = connection.auth.value
  }
  return {
    url: `${baseUrl.replace(/\/$/, '')}/${endpointPath}`,
    headers: {
      'Content-Type': 'application/json',
      ...connection.headers,
      ...authHeaders
    }
  }
}
