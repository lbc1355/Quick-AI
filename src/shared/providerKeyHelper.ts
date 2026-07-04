import { ApiProvider } from './types'

/**
 * 规范化服务商的多 Key 数据。
 * 如果 apiKeys 为空但存在老 apiKey，则初始化一个默认 Key
 */
export function normalizeProviderApiKeys(provider: Partial<ApiProvider>): ApiProvider {
  const apiKeys = provider.apiKeys || []
  if (apiKeys.length === 0 && provider.apiKey) {
    provider.apiKeys = [{ id: 'default', name: '默认 Key', value: provider.apiKey }]
    provider.activeApiKeyId = 'default'
  } else if (apiKeys.length > 0 && !provider.activeApiKeyId) {
    provider.activeApiKeyId = apiKeys[0].id
  }
  return provider as ApiProvider
}

/**
 * 获取服务商当前启用的 API Key 文本值
 */
export function getActiveProviderApiKey(provider: Partial<ApiProvider>): string {
  const normalized = normalizeProviderApiKeys(provider)
  const activeKey = normalized.apiKeys?.find((k) => k.id === normalized.activeApiKeyId)
  return activeKey ? activeKey.value : normalized.apiKey || ''
}

/**
 * 将服务商当前的 legacy apiKey 与选中的 active key 值进行同步
 */
export function syncProviderLegacyApiKey(provider: ApiProvider): ApiProvider {
  provider.apiKey = getActiveProviderApiKey(provider)
  return provider
}
