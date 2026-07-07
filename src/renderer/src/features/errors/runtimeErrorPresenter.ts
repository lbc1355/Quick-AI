import { RuntimeErrorPayload, classifyRuntimeError } from '../../../../shared/runtimeErrors'

interface ErrorPresentation {
  title: string
  description: string
  suggestion: string[]
}

export function getErrorPresentation(error: string | RuntimeErrorPayload): ErrorPresentation {
  let message = ''
  let category: string = 'unknown'

  if (typeof error === 'string') {
    message = error
    category = classifyRuntimeError(error).category
  } else if (error && typeof error === 'object') {
    message = error.message
    category = error.category
  }

  // Allow fallback if category is unknown or system but message contains key patterns
  if (category === 'unknown' || category === 'system') {
    category = classifyRuntimeError(message).category
  }

  switch (category) {
    case 'timeout':
      return {
        title: '大模型连接超时中断 (Terminated)',
        description:
          '智能体在执行高负荷任务（如编写长游戏代码或进行长链思考）时消耗了过长时间，流式响应的连接中途被服务商或网络代理强行断开了。',
        suggestion: [
          '请在“设置”中尝试切换至更稳定的商业 API 提供商（如官方 DeepSeek 通道）以避开免费额度的连接限制；',
          '尝试采用“分段提问”或“渐进式提示”，每次让 AI 生成一部分，以避免单次请求执行时间过长。'
        ]
      }
    case 'rate_limit':
      return {
        title: '触发模型接口限流 (Rate Limited)',
        description: '当前请求的频次或模型配额已超过服务商的限制，API 服务商拒绝了本次访问。',
        suggestion: [
          '请稍等几分钟后再重试本次操作；',
          '您可以在“设置”中临时切换至其他备用的大模型服务商。'
        ]
      }
    case 'unauthorized':
      return {
        title: 'API 密钥验证失败 (Unauthorized)',
        description: '向模型服务商发起接口调用时，对方服务器提示您的 API Key 无效或未授权。',
        suggestion: [
          '请前往“设置”面板，确认您对应提供商 the API Key 填写是否正确；',
          '请检查该 API Key 余额是否充足或是否已被服务商封禁。'
        ]
      }
    case 'network':
      return {
        title: '网络连接失败',
        description:
          '智能体无法连接至当前模型服务商的 API 终点（Endpoint）。可能是您的代理软件阻止了连接，或者是 API 地址填写错误。',
        suggestion: [
          '请检查您本地的 VPN 或代理软件设置，确保它允许 Electron/Node.js 进程发起外部连接；',
          '请核对“设置”中 API URL 是否拼写正确（包含完整的协议和路径）。'
        ]
      }
    default: {
      const cleanMsg = message.replace(/^出错了：/, '')
      return {
        title: '执行过程中发生异常',
        description: cleanMsg || '智能体运行中遇到了未知错误，导致本次交互异常终止。',
        suggestion: [
          '您可以点击下方的“重试并发送”按钮再次尝试；',
          '如果问题持续发生，请检查控制台运行日志或配置文件。'
        ]
      }
    }
  }
}
