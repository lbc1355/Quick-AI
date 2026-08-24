import { createHash } from 'crypto'
import type {
  ChatCompletionMessage,
  ChatToolDeclaration,
  ContextRetentionMode,
  ModelRuntimeConfig,
  ReasoningPreference
} from '../../shared/types'
import { estimateMessagesTokens } from './tokenEstimator'
import type { CallModelOptions } from './modelCallTypes'
import {
  getRequestModelId,
  resolveApiFormat,
  resolveModelConnection,
  resolveTransportId
} from './modelCallRuntime'
import { utf8ByteLength } from './utf8Text'

export const MODEL_REQUEST_RECORD_VERSION = 1
export const DEFAULT_MODEL_REQUEST_PAYLOAD_MAX_BYTES = 8 * 1024 * 1024
const REDACTED_VALUE = '[REDACTED]'

export type ModelRequestRecordState = 'prepared' | 'settled'

export interface ModelRequestContextPolicyRecord {
  contextWindowTokens: number
  contextRetentionMode?: ContextRetentionMode
  beforeMessageCount: number
  afterMessageCount: number
  beforeEstimatedTokens: number
  afterEstimatedTokens: number
  compactedStaleToolResults: number
  compactedStaleToolResultChars: number
}

export interface ModelRequestTargetRecord {
  accountId: string
  providerId: string
  providerType?: ModelRuntimeConfig['providerType']
  endpointType?: ModelRuntimeConfig['endpointType']
  endpoint: string
  authType: string
  headerNames: string[]
  model: string
  apiModel: string
  transportId: string
  apiFormat: string
}

export interface ModelRequestPayload {
  messages: ChatCompletionMessage[]
  tools?: ChatToolDeclaration[]
}

export interface ModelRequestJournalRecord {
  version: typeof MODEL_REQUEST_RECORD_VERSION
  requestId: string
  runId: string
  sessionId: string
  contextEpoch: number
  step: number
  stepId: string
  state: ModelRequestRecordState
  capturedAt: number
  settledAt?: number
  target: ModelRequestTargetRecord
  modelRuntime?: ModelRuntimeConfig
  requestedReasoningPreference: ReasoningPreference
  effectiveReasoningPreference: ReasoningPreference
  contextPolicy: ModelRequestContextPolicyRecord
  reconstructable: boolean
  omissionReason?: string
  redactedPaths: string[]
  messageHash: string
  toolHash: string
  semanticHash: string
  responseHash?: string
  payload?: ModelRequestPayload
}

export interface ModelRequestJournalSummary {
  requestId: string
  step: number
  stepId: string
  state: ModelRequestRecordState
  capturedAt: number
  settledAt?: number
  semanticHash: string
  reconstructable: boolean
}

export interface CreateModelRequestRecordInput {
  runId: string
  sessionId: string
  contextEpoch: number
  step: number
  stepId: string
  modelConfig: CallModelOptions
  messages: ChatCompletionMessage[]
  tools?: ChatToolDeclaration[]
  requestedReasoningPreference: ReasoningPreference
  effectiveReasoningPreference: ReasoningPreference
  contextPolicy: ModelRequestContextPolicyRecord
  capturedAt?: number
  maxPayloadBytes?: number
}

const isSensitiveKey = (key: string): boolean =>
  /(?:api[-_]?key|authorization|password|passwd|secret|access[-_]?token|refresh[-_]?token|cookie|credential)/i.test(
    key
  )

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .map((key) => [key, canonicalize(source[key])])
  )
}

const stableJson = (value: unknown): string => JSON.stringify(canonicalize(value)) ?? 'undefined'

export const hashModelRequestValue = (value: unknown): string =>
  createHash('sha256').update(stableJson(value)).digest('hex')

const sanitizeEndpoint = (raw: string, redactedPaths: string[]): string => {
  try {
    const url = new URL(raw)
    if (url.username || url.password) {
      url.username = ''
      url.password = ''
      redactedPaths.push('target.endpoint.credentials')
    }
    if (url.search) {
      url.search = ''
      redactedPaths.push('target.endpoint.query')
    }
    url.hash = ''
    return url.toString()
  } catch {
    // A malformed/custom endpoint can contain credentials in an arbitrary shape. Keep only a
    // non-reversible fingerprint rather than persisting the raw value.
    redactedPaths.push('target.endpoint')
    return `invalid-endpoint:sha256:${hashModelRequestValue(raw)}`
  }
}

const sanitizeConfigValue = (value: unknown, path: string, redactedPaths: string[]): unknown => {
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeConfigValue(item, `${path}[${index}]`, redactedPaths))
  }
  if (!value || typeof value !== 'object') return value

  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key
    if (isSensitiveKey(key)) {
      result[key] = REDACTED_VALUE
      redactedPaths.push(childPath)
    } else {
      result[key] = sanitizeConfigValue(child, childPath, redactedPaths)
    }
  }
  return result
}

const clonePayload = (payload: ModelRequestPayload): ModelRequestPayload =>
  JSON.parse(JSON.stringify(payload)) as ModelRequestPayload

export function resolveModelRequestTarget(
  modelConfig: CallModelOptions,
  redactedPaths: string[] = []
): ModelRequestTargetRecord {
  const connection = resolveModelConnection(modelConfig)
  return {
    accountId: connection.accountId,
    providerId: connection.providerId,
    providerType: modelConfig.modelRuntime?.providerType ?? modelConfig.providerType,
    endpointType: modelConfig.modelRuntime?.endpointType ?? modelConfig.endpointType,
    endpoint: sanitizeEndpoint(connection.baseUrl, redactedPaths),
    authType: connection.auth.type,
    headerNames: Object.keys(connection.headers).sort(),
    model: modelConfig.model,
    apiModel: getRequestModelId(modelConfig),
    transportId: resolveTransportId(modelConfig),
    apiFormat: resolveApiFormat(modelConfig)
  }
}

export function isModelRequestTargetCompatible(
  record: ModelRequestJournalRecord,
  modelConfig: CallModelOptions
): boolean {
  return (
    hashModelRequestValue(record.target) ===
    hashModelRequestValue(resolveModelRequestTarget(modelConfig))
  )
}

const semanticRequestValue = (record: {
  target: ModelRequestTargetRecord
  modelRuntime?: ModelRuntimeConfig
  requestedReasoningPreference: ReasoningPreference
  effectiveReasoningPreference: ReasoningPreference
  contextPolicy: ModelRequestContextPolicyRecord
  payload: ModelRequestPayload
}): unknown => ({
  target: record.target,
  modelRuntime: record.modelRuntime,
  requestedReasoningPreference: record.requestedReasoningPreference,
  effectiveReasoningPreference: record.effectiveReasoningPreference,
  contextPolicy: record.contextPolicy,
  payload: record.payload
})

export function createModelRequestRecord(
  input: CreateModelRequestRecordInput
): ModelRequestJournalRecord {
  const redactedPaths: string[] = []
  const target = resolveModelRequestTarget(input.modelConfig, redactedPaths)
  const modelRuntime = input.modelConfig.modelRuntime
    ? (sanitizeConfigValue(
        input.modelConfig.modelRuntime,
        'modelRuntime',
        redactedPaths
      ) as ModelRuntimeConfig)
    : undefined
  const payload = clonePayload({
    messages: input.messages,
    ...(input.tools ? { tools: input.tools } : {})
  })
  const messageHash = hashModelRequestValue(payload.messages)
  const toolHash = hashModelRequestValue(payload.tools || [])
  const semanticHash = hashModelRequestValue(
    semanticRequestValue({
      target,
      modelRuntime,
      requestedReasoningPreference: input.requestedReasoningPreference,
      effectiveReasoningPreference: input.effectiveReasoningPreference,
      contextPolicy: input.contextPolicy,
      payload
    })
  )
  const maxPayloadBytes = input.maxPayloadBytes ?? DEFAULT_MODEL_REQUEST_PAYLOAD_MAX_BYTES
  const serializedPayloadBytes = utf8ByteLength(JSON.stringify(payload))
  const reconstructable = serializedPayloadBytes <= maxPayloadBytes

  return {
    version: MODEL_REQUEST_RECORD_VERSION,
    requestId: `${input.runId}:request:${input.step}`,
    runId: input.runId,
    sessionId: input.sessionId,
    contextEpoch: input.contextEpoch,
    step: input.step,
    stepId: input.stepId,
    state: 'prepared',
    capturedAt: input.capturedAt ?? Date.now(),
    target,
    ...(modelRuntime ? { modelRuntime } : {}),
    requestedReasoningPreference: input.requestedReasoningPreference,
    effectiveReasoningPreference: input.effectiveReasoningPreference,
    contextPolicy: input.contextPolicy,
    reconstructable,
    ...(reconstructable
      ? { payload }
      : {
          omissionReason: `Request payload exceeded the ${maxPayloadBytes}-byte UTF-8 journal limit.`
        }),
    redactedPaths: Array.from(new Set(redactedPaths)).sort(),
    messageHash,
    toolHash,
    semanticHash
  }
}

export function settleModelRequestRecord(
  record: ModelRequestJournalRecord,
  response: ChatCompletionMessage,
  settledAt = Date.now()
): ModelRequestJournalRecord {
  return {
    ...record,
    state: 'settled',
    settledAt,
    responseHash: hashModelRequestValue(response)
  }
}

export function summarizeModelRequestRecord(
  record: ModelRequestJournalRecord
): ModelRequestJournalSummary {
  return {
    requestId: record.requestId,
    step: record.step,
    stepId: record.stepId,
    state: record.state,
    capturedAt: record.capturedAt,
    settledAt: record.settledAt,
    semanticHash: record.semanticHash,
    reconstructable: record.reconstructable
  }
}

export function verifyModelRequestRecord(record: ModelRequestJournalRecord): boolean {
  if (
    !record ||
    typeof record !== 'object' ||
    record.version !== MODEL_REQUEST_RECORD_VERSION ||
    !record.reconstructable ||
    !record.payload ||
    !Array.isArray(record.payload.messages) ||
    (record.payload.tools !== undefined && !Array.isArray(record.payload.tools)) ||
    !record.target ||
    typeof record.target !== 'object'
  ) {
    return false
  }
  if (hashModelRequestValue(record.payload.messages) !== record.messageHash) return false
  if (hashModelRequestValue(record.payload.tools || []) !== record.toolHash) return false
  return (
    hashModelRequestValue(
      semanticRequestValue({
        target: record.target,
        modelRuntime: record.modelRuntime,
        requestedReasoningPreference: record.requestedReasoningPreference,
        effectiveReasoningPreference: record.effectiveReasoningPreference,
        contextPolicy: record.contextPolicy,
        payload: record.payload
      })
    ) === record.semanticHash
  )
}

export function createModelRequestContextPolicy(input: {
  contextWindowTokens: number
  contextRetentionMode?: ContextRetentionMode
  beforeMessages: ChatCompletionMessage[]
  afterMessages: ChatCompletionMessage[]
  compactedStaleToolResults: number
  compactedStaleToolResultChars: number
}): ModelRequestContextPolicyRecord {
  return {
    contextWindowTokens: input.contextWindowTokens,
    contextRetentionMode: input.contextRetentionMode,
    beforeMessageCount: input.beforeMessages.length,
    afterMessageCount: input.afterMessages.length,
    beforeEstimatedTokens: estimateMessagesTokens(input.beforeMessages),
    afterEstimatedTokens: estimateMessagesTokens(input.afterMessages),
    compactedStaleToolResults: input.compactedStaleToolResults,
    compactedStaleToolResultChars: input.compactedStaleToolResultChars
  }
}
