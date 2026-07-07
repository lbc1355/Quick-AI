import { existsSync, renameSync, statSync, appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getLogsRoot } from './paths'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

const LEVEL_COLORS = {
  DEBUG: '\x1b[90m', // Gray
  INFO: '\x1b[32m', // Green
  WARN: '\x1b[33m', // Yellow
  ERROR: '\x1b[31m' // Red
}
const COLOR_RESET = '\x1b[0m'

const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5MB
const BACKUP_COUNT = 3

/** Local wall-clock timestamp `YYYY-MM-DD HH:mm:ss.SSS`, shared by the app and session loggers. */
export function formatTimestamp(date: Date): string {
  const Y = date.getFullYear()
  const M = String(date.getMonth() + 1).padStart(2, '0')
  const D = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${Y}-${M}-${D} ${h}:${m}:${s}.${ms}`
}

export class Logger {
  private logPath: string
  private maxLogSize: number

  constructor(fileName = 'main.log', maxLogSize = MAX_LOG_SIZE) {
    this.maxLogSize = maxLogSize
    // If getLogsRoot fails or throws, fall back to process.cwd()
    try {
      this.logPath = join(getLogsRoot(), fileName)
    } catch {
      this.logPath = join(process.cwd(), fileName)
    }
  }

  private rotateIfNeed(): void {
    try {
      if (!existsSync(this.logPath)) return
      const stats = statSync(this.logPath)
      if (stats.size < this.maxLogSize) return

      // Rotate backups: e.g., main.log.2 -> main.log.3, main.log.1 -> main.log.2
      for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
        const src = `${this.logPath}.${i}`
        const dest = `${this.logPath}.${i + 1}`
        if (existsSync(src)) {
          renameSync(src, dest)
        }
      }

      // Rotate active: main.log -> main.log.1
      renameSync(this.logPath, `${this.logPath}.1`)
    } catch (err) {
      console.warn('Logger rotation failed:', (err as Error).message)
    }
  }

  private write(level: LogLevel, category: string, message: string, ...args: unknown[]): void {
    const timestamp = formatTimestamp(new Date())
    let formattedMessage = message
    if (args.length > 0) {
      formattedMessage +=
        ' ' +
        args
          .map((arg) => {
            if (arg instanceof Error) return arg.stack || arg.message
            if (typeof arg === 'object') return JSON.stringify(arg)
            return String(arg)
          })
          .join(' ')
    }

    const fileLine = `[${timestamp}] [${level}] [${category}] ${formattedMessage}\n`
    const color = LEVEL_COLORS[level] || ''
    const consoleLine = `[${timestamp}] ${color}[${level}]${COLOR_RESET} [${category}] ${formattedMessage}`

    // 1. Output to console/terminal
    if (level === 'ERROR') {
      console.error(consoleLine)
    } else if (level === 'WARN') {
      console.warn(consoleLine)
    } else {
      console.log(consoleLine)
    }

    // 2. Output to file
    try {
      this.rotateIfNeed()
      const dir = join(this.logPath, '..')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      appendFileSync(this.logPath, fileLine, 'utf8')
    } catch (err) {
      // Degrade gracefully if filesystem write fails
      console.warn('Failed to write log to file:', (err as Error).message)
    }
  }

  debug(category: string, message: string, ...args: unknown[]): void {
    this.write('DEBUG', category, message, ...args)
  }

  info(category: string, message: string, ...args: unknown[]): void {
    this.write('INFO', category, message, ...args)
  }

  warn(category: string, message: string, ...args: unknown[]): void {
    this.write('WARN', category, message, ...args)
  }

  error(category: string, message: string, ...args: unknown[]): void {
    this.write('ERROR', category, message, ...args)
  }
}

export const logger = new Logger()
