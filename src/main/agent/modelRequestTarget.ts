import type { ResolvedProviderConnection } from '../../shared/types'

export interface ModelRequestTarget {
  url: string
  headers: Record<string, string>
}

export function buildProviderRequestHeaders(
  connection: ResolvedProviderConnection,
  baseHeaders: Record<string, string> = {}
): Record<string, string> {
  const authHeaders: Record<string, string> = {}
  if (connection.auth.type === 'bearer' && connection.auth.token) {
    authHeaders.Authorization = `Bearer ${connection.auth.token}`
  } else if (connection.auth.type === 'header' && connection.auth.value) {
    authHeaders[connection.auth.name] = connection.auth.value
  }
  return {
    ...baseHeaders,
    ...connection.headers,
    ...authHeaders
  }
}

/** OpenAI-compatible authentication shared by the built-in protocol transports. */
export function buildOpenAICompatibleRequestTarget(
  connection: ResolvedProviderConnection,
  endpointPath: string
): ModelRequestTarget {
  const baseUrl = connection.baseUrl.trim()
  if (!baseUrl) throw new Error('Provider API URL is not configured.')
  return {
    url: `${baseUrl.replace(/\/$/, '')}/${endpointPath}`,
    headers: buildProviderRequestHeaders(connection, { 'Content-Type': 'application/json' })
  }
}
