import { describe, it, expect } from 'vitest'
import { getErrorPresentation } from './runtimeErrorPresenter'
import { RuntimeErrorPayload } from '../../../../shared/runtimeErrors'

describe('runtimeErrorPresenter', () => {
  it('resolves timeout presentation from payload', () => {
    const payload: RuntimeErrorPayload = {
      message: 'Connection was terminated',
      category: 'timeout',
      source: 'model_api',
      timestamp: Date.now()
    }
    const result = getErrorPresentation(payload)
    expect(result.title).toBe('大模型连接超时中断 (Terminated)')
    expect(result.suggestion[0]).toContain('切换至更稳定的商业 API 提供商')
  })

  it('resolves rate_limit presentation from string', () => {
    const result = getErrorPresentation('API limit 429 reached')
    expect(result.title).toBe('触发模型接口限流 (Rate Limited)')
    expect(result.suggestion[0]).toContain('稍等几分钟')
  })

  it('resolves unauthorized presentation from string', () => {
    const result = getErrorPresentation('unauthorized access key is invalid')
    expect(result.title).toBe('API 密钥验证失败 (Unauthorized)')
    expect(result.suggestion[0]).toContain('确认您对应提供商')
  })

  it('resolves network presentation from string', () => {
    const result = getErrorPresentation('connect ETIMEDOUT')
    expect(result.title).toBe('网络连接失败')
    expect(result.suggestion[0]).toContain('检查您本地的 VPN')
  })

  it('resolves fallback presentation for unknown errors', () => {
    const result = getErrorPresentation('Some random crash')
    expect(result.title).toBe('执行过程中发生异常')
    expect(result.description).toBe('Some random crash')
  })

  it('resolves clean message with prefix removed', () => {
    const result = getErrorPresentation('出错了：Some crash')
    expect(result.description).toBe('Some crash')
  })
})
