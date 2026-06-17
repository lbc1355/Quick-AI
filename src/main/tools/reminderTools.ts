import { ToolArgs } from '../../shared/types'
import { cancelDesktopReminder, listPendingReminders, scheduleDesktopReminder } from './reminders'
import { ToolDefinition, ToolExecutionContext } from './types'

function formatReminderDelay(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`

  const totalMinutes = Math.ceil(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (minutes === 0) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`
}

function formatReminderLine(reminder: {
  id: string
  title: string
  message: string
  triggerAt: number
}): string {
  return `- ${reminder.id}: "${reminder.message}" at ${new Date(reminder.triggerAt).toISOString()} (title: "${reminder.title}", in ${formatReminderDelay(reminder.triggerAt - Date.now())})`
}

function getReminderClickHandler(ctx: ToolExecutionContext): (() => void) | undefined {
  const win = ctx.mainWindow
  if (!win) return undefined

  return () => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

export const reminderTools: Record<string, ToolDefinition> = {
  schedule_reminder: {
    name: 'schedule_reminder',
    title: 'Schedule Reminder',
    description:
      'Schedule a desktop notification after a delay. Use for requests like "remind me in 10 minutes to drink water". The reminder is an in-app timer and requires QuickAI to remain running until it fires.',
    tags: [
      'reminder',
      'timer',
      'alarm',
      'schedule',
      'notify',
      'delay',
      '提醒',
      '定时',
      '闹钟',
      '通知'
    ],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        delaySeconds: {
          type: 'number',
          description:
            'Delay before the notification fires, in seconds. Example: 600 for 10 minutes.'
        },
        title: {
          type: 'string',
          description: 'Optional notification title. Defaults to "Reminder".'
        },
        message: {
          type: 'string',
          description: 'Reminder message to show in the desktop notification.'
        }
      },
      required: ['delaySeconds', 'message']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      const reminder = scheduleDesktopReminder({
        delaySeconds: args.delaySeconds,
        title: args.title,
        message: args.message,
        onClick: getReminderClickHandler(ctx)
      })
      const delayText = formatReminderDelay(reminder.triggerAt - Date.now())
      const triggerAt = new Date(reminder.triggerAt).toISOString()

      return {
        resultForModel: [
          'Reminder scheduled.',
          `Reminder ID: ${reminder.id}`,
          `Message: ${reminder.message}`,
          `Trigger time: ${triggerAt}`,
          `Delay: ${delayText}`,
          'Note: QuickAI must remain running for this in-app reminder to fire.'
        ].join('\n'),
        resultForUi: {
          title: 'Reminder Scheduled',
          summary: `${reminder.message} in ${delayText}`
        }
      }
    }
  },
  list_reminders: {
    name: 'list_reminders',
    title: 'List Reminders',
    description:
      'List pending in-app reminder timers that will send desktop notifications while QuickAI remains running.',
    tags: ['reminder', 'timer', 'alarm', 'schedule', 'list', '提醒', '定时', '闹钟'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void args
      void ctx
      const reminders = listPendingReminders()
      if (reminders.length === 0) {
        return {
          resultForModel: 'No pending reminders.',
          resultForUi: {
            title: 'Reminders',
            summary: 'No pending reminders'
          }
        }
      }

      return {
        resultForModel: ['Pending reminders:', ...reminders.map(formatReminderLine)].join('\n'),
        resultForUi: {
          title: 'Reminders',
          summary: `${reminders.length} pending reminder${reminders.length === 1 ? '' : 's'}`
        }
      }
    }
  },
  cancel_reminder: {
    name: 'cancel_reminder',
    title: 'Cancel Reminder',
    description: 'Cancel a pending in-app reminder by reminderId.',
    tags: ['reminder', 'timer', 'alarm', 'schedule', 'cancel', '提醒', '定时', '闹钟'],
    category: 'system',
    risk: 'low',
    implemented: true,
    discoverable: true,
    parameters: {
      type: 'object',
      properties: {
        reminderId: {
          type: 'string',
          description: 'Reminder ID returned by schedule_reminder or shown by list_reminders.'
        }
      },
      required: ['reminderId']
    },
    execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
      void ctx
      const reminderId =
        typeof args.reminderId === 'string' && args.reminderId.trim() ? args.reminderId.trim() : ''
      if (!reminderId) {
        throw new Error('Missing or invalid reminderId parameter')
      }

      const reminder = cancelDesktopReminder(reminderId)
      if (!reminder) {
        throw new Error(`Reminder not found: ${reminderId}`)
      }

      return {
        resultForModel: `Cancelled reminder ${reminder.id}: "${reminder.message}"`,
        resultForUi: {
          title: 'Reminder Cancelled',
          summary: reminder.message
        }
      }
    }
  }
}
