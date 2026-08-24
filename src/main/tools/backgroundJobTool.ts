import type { ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import {
  getBackgroundJobForSession,
  markBackgroundJobReported
} from '../agent/backgroundJobManager'
import { createToolResult } from './result'
import type { ToolDefinition } from './types'

export const backgroundJobReadTool: ToolDefinition = {
  name: 'background_job_read',
  title: 'Read Background Task Result',
  description:
    'Reads the persisted status and result of a background subagent or shell task owned by the current conversation. Call this after an automatic completion notice; do not poll running jobs.',
  tags: ['background', 'task', 'job', 'result', 'read'],
  category: 'system',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      jobId: {
        type: 'string',
        description: 'The job ID from the background completion notice.'
      }
    },
    required: ['jobId']
  },
  execute: async (args: ToolArgs, ctx) => {
    const jobId = typeof args.jobId === 'string' ? args.jobId.trim() : ''
    if (!jobId) throw new Error('background_job_read requires a jobId.')

    const sessionId = ctx.reqId ? getRun(ctx.reqId)?.sessionId : undefined
    const job = getBackgroundJobForSession(jobId, sessionId)
    if (!job) throw new Error(`Background job ${jobId} was not found in this conversation.`)

    if (job.status !== 'running') markBackgroundJobReported(job.id, 'read')
    const header = [
      `Job ID: ${job.id}`,
      `Type: ${job.type}`,
      `Status: ${job.status}`,
      `Title: ${job.title}`,
      job.description ? `Description: ${job.description}` : '',
      job.error ? `Error: ${job.error}` : '',
      job.metadata ? `Metadata: ${JSON.stringify(job.metadata)}` : ''
    ].filter(Boolean)
    const details = [
      ...header,
      '',
      'Persisted result:',
      job.output || '(No persisted output.)'
    ].join('\n')

    return createToolResult({
      resultForModel: details,
      title: `Read Background Job: ${job.id}`,
      summary: `${job.type} job is ${job.status}`,
      details
    })
  }
}
