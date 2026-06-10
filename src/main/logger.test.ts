import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, rmSync, readFileSync } from 'fs'
import * as fs from 'fs'
import { Logger } from './logger'

let home: string

beforeEach(() => {
  home = join(tmpdir(), `quickai-logger-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  process.env.QUICKAI_HOME = home
})

afterEach(() => {
  delete process.env.QUICKAI_HOME
  rmSync(home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('Logger class', () => {
  it('creates log file and writes formatted logs', () => {
    const logger = new Logger('test.log')
    logger.info('TestCat', 'hello log')
    logger.warn('TestCat', 'warning log')
    logger.error('TestCat', 'error log')

    const logPath = join(home, 'logs', 'test.log')
    expect(existsSync(logPath)).toBe(true)

    const content = readFileSync(logPath, 'utf8')
    expect(content).toContain('[INFO] [TestCat] hello log')
    expect(content).toContain('[WARN] [TestCat] warning log')
    expect(content).toContain('[ERROR] [TestCat] error log')
  })

  it('supports stringifying extra arguments', () => {
    const logger = new Logger('test.log')
    logger.info('ArgsCat', 'Message:', { foo: 'bar' }, new Error('test-err'))

    const logPath = join(home, 'logs', 'test.log')
    const content = readFileSync(logPath, 'utf8')
    expect(content).toContain('[INFO] [ArgsCat] Message: {"foo":"bar"}')
    expect(content).toContain('Error: test-err')
  })

  it('rotates log files when size exceeds threshold', () => {
    const logName = 'rotate.log'
    const logPath = join(home, 'logs', logName)
    
    // Create logger with a very small size threshold (5 bytes) so any write triggers rotation
    const logger = new Logger(logName, 5)

    // Write initial log
    logger.info('Init', 'first line')
    expect(existsSync(logPath)).toBe(true)

    // Trigger another log to fire rotation (since first line size is way larger than 5 bytes)
    logger.info('Rot', 'second line')

    // Expect backup file rotate.log.1 to exist and contain 'first line'
    const backupPath = `${logPath}.1`
    expect(existsSync(backupPath)).toBe(true)
    const backupContent = readFileSync(backupPath, 'utf8')
    expect(backupContent).toContain('first line')

    // Expect rotate.log to exist and contain 'second line'
    const activeContent = readFileSync(logPath, 'utf8')
    expect(activeContent).toContain('second line')
    expect(activeContent).not.toContain('first line')
  })
})
