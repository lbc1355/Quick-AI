import { ToolArgs } from '../../shared/types'
import { cancelDesktopReminder, listPendingReminders, scheduleDesktopReminder } from './reminders'
import {
  createCancelReminderResult,
  createListRemindersResult,
  createScheduleReminderResult
} from './reminderResult'
import { ToolDefinition, ToolExecutionContext } from './types'

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
      return createScheduleReminderResult(reminder)
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
      return createListRemindersResult(reminders)
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

      return createCancelReminderResult(reminder)
    }
  }
}
