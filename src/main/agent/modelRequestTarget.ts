export interface ProviderConnection {
  apiUrl: string
  apiKey: string
}

export interface ModelRequestTarget {
  url: string
  headers: Record<string, string>
}

/** OpenAI-compatible authentication shared by the built-in protocol transports. */
export function buildOpenAICompatibleRequestTarget(
  connection: ProviderConnection,
  endpointPath: string
): ModelRequestTarget {
  return {
    url: `${connection.apiUrl.replace(/\/$/, '')}/${endpointPath}`,
    headers: {
      'Content-Type': 'application/json',
      ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {})
    }
  }
}
