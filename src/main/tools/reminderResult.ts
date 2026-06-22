import { ScheduledReminder } from './reminders'
import { ToolExecutionResult } from './types'

export function formatReminderDelay(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`

  const totalMinutes = Math.ceil(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (minutes === 0) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`
}

export function formatReminderLine(reminder: ScheduledReminder): string {
  return `- ${reminder.id}: "${reminder.message}" at ${new Date(reminder.triggerAt).toISOString()} (title: "${reminder.title}", in ${formatReminderDelay(reminder.triggerAt - Date.now())})`
}

export function createScheduleReminderResult(reminder: ScheduledReminder): ToolExecutionResult {
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

export function createListRemindersResult(reminders: ScheduledReminder[]): ToolExecutionResult {
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

export function createCancelReminderResult(reminder: ScheduledReminder): ToolExecutionResult {
  return {
    resultForModel: `Cancelled reminder ${reminder.id}: "${reminder.message}"`,
    resultForUi: {
      title: 'Reminder Cancelled',
      summary: reminder.message
    }
  }
}