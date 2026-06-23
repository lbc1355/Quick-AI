import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, rmSync, readFileSync } from 'fs'
import { SessionLogger } from './sessionLogger'

let home: string

beforeEach(() => {
  home = join(tmpdir(), `quickai-sesslog-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  process.env.QUICKAI_HOME = home
})

afterEach(() => {
  delete process.env.QUICKAI_HOME
  rmSync(home, { recursive: true, force: true })
})

describe('SessionLogger', () => {
  it('writes session trace logs in Markdown format', () => {
    const sessionId = 'test-session-123'
    const runId = 'run-abc'

    // 1. Log Run Start
    SessionLogger.logRunStart(sessionId, runId, {
      model: 'gpt-4o',
      apiUrl: 'https://api.openai.com/v1',
      skillName: 'Test Skill',
      messages: [
        { role: 'system', content: 'You are an assistant.' },
        { role: 'user', content: 'Hello!' }
      ]
    })

    const logPath = join(home, 'logs', `session-${sessionId}.md`)
    expect(existsSync(logPath)).toBe(true)

    let content = readFileSync(logPath, 'utf8')
    expect(content).toContain('# Session Debug Log: test-session-123')
    expect(content).toContain('Run Started: `run-abc`')
    expect(content).toContain('**Model**: `gpt-4o`')
    expect(content).toContain('**Messages**: `2`')
    expect(content).toContain('**Structured Log**')

    const jsonlPath = join(home, 'logs', `session-${sessionId}.jsonl`)
    expect(existsSync(jsonlPath)).toBe(true)
    let jsonlLines = readFileSync(jsonlPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(jsonlLines[0]).toMatchObject({
      type: 'run_start',
      runId,
      model: 'gpt-4o',
      context: { messageCount: 2 }
    })

    // 2. Log Step Start
    SessionLogger.logStepStart(sessionId, 1, 5)
    content = readFileSync(logPath, 'utf8')
    expect(content).toContain('### Step 1 / 5')

    // 3. Log Model Response
    SessionLogger.logModelResponse(sessionId, {
      role: 'assistant',
      content: 'I will run a tool.',
      reasoning_content: 'Let me think first.',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'workspace_list_files', arguments: '{"path":"."}' }
        }
      ]
    })
    content = readFileSync(logPath, 'utf8')
    expect(content).toContain('**Content chars**')
    expect(content).toContain('workspace_list_files')
    jsonlLines = readFileSync(jsonlPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const modelResponse = jsonlLines.find((event) => event.type === 'model_response')
    expect(modelResponse).toMatchObject({
      type: 'model_response',
      contentChars: 18,
      reasoningChars: 19
    })
    expect(modelResponse.toolCalls[0]).toMatchObject({ name: 'workspace_list_files' })

    // 4. Log Tool Execution
    SessionLogger.logToolExecution(
      sessionId,
      'call_1',
      'workspace_list_files',
      { path: '.' },
      'allow',
      'success',
      120,
      'file1.txt\nfile2.txt'
    )
    content = readFileSync(logPath, 'utf8')
    expect(content).toContain('**Tool**: `workspace_list_files`')
    expect(content).toContain('**Call ID**: `call_1`')
    expect(content).toContain('**Status**: `success`')
    expect(content).toContain('**Duration**: `120ms`')
    expect(content).not.toContain('file1.txt')
    jsonlLines = readFileSync(jsonlPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const toolExecution = jsonlLines.find((event) => event.type === 'tool_execution')
    expect(toolExecution).toMatchObject({
      toolName: 'workspace_list_files',
      args: { path: '.' },
      status: 'success',
      durationMs: 120,
      outputChars: 'file1.txt\nfile2.txt'.length
    })

    // 5. Log Run End
    SessionLogger.logRunEnd(sessionId, 'completed')
    content = readFileSync(logPath, 'utf8')
    expect(content).toContain('Run Finished: `completed`')
  })
})
