import { showDesktopNotification } from './helpers'

const MAX_DELAY_MS = 2_147_483_647

export interface ScheduledReminder {
  id: string
  title: string
  message: string
  createdAt: number
  triggerAt: number
}

interface PendingReminder extends ScheduledReminder {
  timeout: ReturnType<typeof setTimeout>
}

type NotificationSender = (title: string, body: string, onClick?: () => void) => boolean

const pendingReminders = new Map<string, PendingReminder>()
let nextReminderSerial = 1
let notificationSender: NotificationSender = showDesktopNotification

function createReminderId(now: number): string {
  return `reminder-${now.toString(36)}-${nextReminderSerial++}`
}

function readDelayMs(delaySeconds: unknown): number {
  const value =
    typeof delaySeconds === 'number'
      ? delaySeconds
      : typeof delaySeconds === 'string' && delaySeconds.trim()
        ? Number(delaySeconds)
        : NaN

  if (!Number.isFinite(value)) {
    throw new Error('Missing or invalid delaySeconds parameter')
  }

  const delayMs = Math.floor(value * 1000)
  if (delayMs < 1000) {
    throw new Error('delaySeconds must be at least 1')
  }
  if (delayMs > MAX_DELAY_MS) {
    throw new Error('delaySeconds is too large for an in-app reminder timer')
  }
  return delayMs
}

function cleanText(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text || fallback).slice(0, maxLength)
}

export function scheduleDesktopReminder(args: {
  delaySeconds: unknown
  title?: unknown
  message: unknown
  onClick?: () => void
}): ScheduledReminder {
  const delayMs = readDelayMs(args.delaySeconds)
  const now = Date.now()
  const reminder: ScheduledReminder = {
    id: createReminderId(now),
    title: cleanText(args.title, 'Reminder', 120),
    message: cleanText(args.message, '', 1000),
    createdAt: now,
    triggerAt: now + delayMs
  }

  if (!reminder.message) {
    throw new Error('Missing or invalid message parameter')
  }

  const timeout = setTimeout(() => {
    pendingReminders.delete(reminder.id)
    notificationSender(reminder.title, reminder.message, args.onClick)
  }, delayMs)

  if (typeof timeout === 'object' && 'unref' in timeout) {
    timeout.unref()
  }

  pendingReminders.set(reminder.id, { ...reminder, timeout })
  return reminder
}

export function cancelDesktopReminder(id: string): ScheduledReminder | undefined {
  const reminder = pendingReminders.get(id)
  if (!reminder) return undefined

  clearTimeout(reminder.timeout)
  pendingReminders.delete(id)
  const { timeout: _timeout, ...scheduledReminder } = reminder
  return scheduledReminder
}

export function listPendingReminders(): ScheduledReminder[] {
  return Array.from(pendingReminders.values())
    .sort((a, b) => a.triggerAt - b.triggerAt)
    .map(({ timeout: _timeout, ...reminder }) => reminder)
}

export function clearPendingRemindersForTests(): void {
  for (const reminder of pendingReminders.values()) {
    clearTimeout(reminder.timeout)
  }
  pendingReminders.clear()
  nextReminderSerial = 1
  notificationSender = showDesktopNotification
}

export function setReminderNotificationSenderForTests(sender: NotificationSender): void {
  notificationSender = sender
}
