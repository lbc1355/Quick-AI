import { ChatCompletionMessage, Message, Project, SessionResource } from '../../../shared/types'
import { estimateMessagesTokens } from '../../../shared/tokenEstimator'

interface AttachedFile {
  name: string
  content: string
  type: string
}

interface ContextLengthOptions {
  messages: Message[]
  systemPrompt?: string
  project?: Pick<Project, 'name' | 'path'> | null
  resources?: SessionResource[]
  input?: string
  attachedFiles?: AttachedFile[]
}

interface DraftContextOptions {
  input?: string
  attachedFiles?: AttachedFile[]
}

function buildContentWithFiles(content: string, files?: AttachedFile[]): string {
  if (!files || files.length === 0) return content

  const parts = [content]
  for (const file of files) {
    if (file.type === 'image') {
      parts.push(`\n[Image attachment: ${file.name}]`)
    } else {
      parts.push(`\n[Reference file: ${file.name}]\n${file.content}`)
    }
  }

  return parts.join('\n')
}

function buildProjectContext(project?: Pick<Project, 'name' | 'path'> | null): string {
  if (!project) return ''
  return [`Project context:`, `Name: ${project.name}`, `Path: ${project.path}`].join('\n')
}

function buildResourceContext(resources?: SessionResource[]): string {
  if (!resources || resources.length === 0) return ''

  const lines = [
    'Cached resources attached to this conversation:',
    ...resources
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((resource, index) => {
        const chunks = resource.chunks
          .map((chunk) => chunk.summary || chunk.text?.slice(0, 240) || '')
          .filter(Boolean)
          .slice(0, 3)

        return [
          `${index + 1}. ${resource.title || resource.source}`,
          `Kind: ${resource.kind}`,
          `Status: ${resource.status}`,
          resource.summary ? `Summary: ${resource.summary}` : '',
          chunks.length > 0 ? `Chunks: ${chunks.join(' / ')}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      })
  ]

  const text = lines.join('\n\n')
  return text.length > 4000 ? `${text.slice(0, 3950)}\n[Summary truncated]` : text
}

function buildBaseContextMessages({
  messages,
  systemPrompt,
  project,
  resources
}: Omit<ContextLengthOptions, 'input' | 'attachedFiles'>): ChatCompletionMessage[] {
  const apiMessages: ChatCompletionMessage[] = []

  if (systemPrompt?.trim()) {
    apiMessages.push({ role: 'system', content: systemPrompt })
  }

  const projectContext = buildProjectContext(project)
  if (projectContext) {
    apiMessages.push({ role: 'system', content: projectContext })
  }

  const resourceContext = buildResourceContext(resources)
  if (resourceContext) {
    apiMessages.push({ role: 'system', content: resourceContext })
  }

  for (const message of messages) {
    if (message.isRuntimeError) continue
    apiMessages.push({
      role: message.role,
      content: buildContentWithFiles(message.content, message.files)
    })
  }

  return apiMessages
}

function buildSteeringContextMessages({
  systemPrompt,
  project,
  resources
}: Pick<ContextLengthOptions, 'systemPrompt' | 'project' | 'resources'>): ChatCompletionMessage[] {
  const apiMessages: ChatCompletionMessage[] = []

  if (systemPrompt?.trim()) {
    apiMessages.push({ role: 'system', content: systemPrompt })
  }

  const projectContext = buildProjectContext(project)
  if (projectContext) {
    apiMessages.push({ role: 'system', content: projectContext })
  }

  const resourceContext = buildResourceContext(resources)
  if (resourceContext) {
    apiMessages.push({ role: 'system', content: resourceContext })
  }

  return apiMessages
}

function buildHistoryContextMessages(messages: Message[]): ChatCompletionMessage[] {
  return messages
    .filter((message) => !message.isRuntimeError)
    .map((message) => ({
      role: message.role,
      content: buildContentWithFiles(message.content, message.files)
    }))
}

export function estimateBaseConversationContextTokens(
  options: Omit<ContextLengthOptions, 'input' | 'attachedFiles'>
): number {
  return estimateMessagesTokens(buildBaseContextMessages(options))
}

export function estimateSteeringContextTokens(
  options: Pick<ContextLengthOptions, 'systemPrompt' | 'project' | 'resources'>
): number {
  const messages = buildSteeringContextMessages(options)
  return messages.length > 0 ? estimateMessagesTokens(messages) : 0
}

export function estimateHistoryContextTokens(messages: Message[]): number {
  const historyMessages = buildHistoryContextMessages(messages)
  return historyMessages.length > 0 ? estimateMessagesTokens(historyMessages) : 0
}

export function estimateDraftContextTokens({ input, attachedFiles }: DraftContextOptions): number {
  const draftContent = buildContentWithFiles(input || '', attachedFiles)
  if (!draftContent.trim()) return 0

  return estimateMessagesTokens([{ role: 'user', content: draftContent }])
}

export function estimateConversationContextTokens({
  input,
  attachedFiles,
  ...baseOptions
}: ContextLengthOptions): number {
  return (
    estimateBaseConversationContextTokens(baseOptions) +
    estimateDraftContextTokens({ input, attachedFiles })
  )
}

export function formatContextTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return `${tokens}`
}
