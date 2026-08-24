import { ToolArgs } from '../../shared/types'
import { showDesktopNotification } from './helpers'
import { ToolDefinition, ToolExecutionContext } from './types'

export const notifyTool: ToolDefinition = {
  name: 'notify',
  title: 'Notify',
  description:
    'Send a desktop notification to the user. Use this to alert the user when a long-running task completes, when you have important results, or when you need the user to check something. The notification appears in the OS notification center.',
  tags: ['notification', 'alert', 'notify', 'message', '桌面通知'],
  category: 'system',
  risk: 'low',
  isConcurrencySafe: () => false,
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Notification title — keep it short and descriptive.'
      },
      body: {
        type: 'string',
        description: 'Notification body — the main message.'
      }
    },
    required: ['title', 'body']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    void ctx
    const title =
      typeof args.title === 'string' && args.title.trim() ? args.title.trim() : 'QuickAI'
    const body = typeof args.body === 'string' ? args.body.trim() : ''

    const sent = showDesktopNotification(title, body)

    return {
      resultForModel: sent
        ? `Notification sent: "${title}"`
        : 'Notification not supported on this system.',
      resultForUi: {
        title: 'Notification',
        summary: sent ? title : 'Notifications unsupported'
      }
    }
  }
}
