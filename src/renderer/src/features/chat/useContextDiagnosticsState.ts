import { useMemo } from 'react'
import type { ApiProvider, ModelRuntimeConfig, Project, Session } from '../../../../shared/types'
import { getProviderModelContextWindowInfo } from '../../../../shared/modelCatalog'
import { estimateDraftContextTokens } from '../../utils/contextLength'
import {
  buildContextCompositionSegments,
  summarizeConversationTokenUsage,
  summarizePromptCacheStats,
  type ContextDiagnosticsSnapshot
} from '../../utils/contextDiagnostics'

interface AttachedFile {
  name: string
  content: string
  type: string
}

interface UseContextDiagnosticsStateOptions {
  activeSession?: Session
  activeProject?: Project | null
  activeProviderConfig?: ApiProvider
  activeModelRuntimeConfig?: ModelRuntimeConfig
  selectedModel: string
  systemPrompt: string
  permissions: Record<string, string>
  skillsCount: number
  attachedFiles: AttachedFile[]
}

interface UseContextDiagnosticsStateResult {
  activeModelContextWindowTokens: number
  contextBaseTokenEstimate: number
  contextDiagnostics: ContextDiagnosticsSnapshot
}

export function useContextDiagnosticsState({
  activeSession,
  activeProject,
  activeProviderConfig,
  activeModelRuntimeConfig,
  selectedModel,
  systemPrompt,
  permissions,
  skillsCount,
  attachedFiles
}: UseContextDiagnosticsStateOptions): UseContextDiagnosticsStateResult {
  const activeModelContextWindowTokens =
    activeModelRuntimeConfig?.contextWindowTokens ??
    getProviderModelContextWindowInfo(activeProviderConfig, selectedModel).tokens

  const draftAttachmentTokenEstimate = useMemo(
    () => estimateDraftContextTokens({ attachedFiles }),
    [attachedFiles]
  )
  const contextWindowInfo = useMemo(
    () => getProviderModelContextWindowInfo(activeProviderConfig, selectedModel),
    [activeProviderConfig, selectedModel]
  )
  const contextWindowTokens = contextWindowInfo.tokens
  const activeProjectLabel = activeProject
    ? `${activeProject.name}${activeProject.path ? ` (${activeProject.path})` : ''}`
    : undefined
  const contextComposition = useMemo(() => {
    const segments = buildContextCompositionSegments({
      messages: activeSession?.messages || [],
      systemPrompt,
      projectLabel: activeProjectLabel,
      resources: activeSession?.resources
    })
    const steeringTokens = segments
      .filter((segment) => segment.role === 'system')
      .reduce((total, segment) => total + segment.tokenEstimate, 0)
    const conversationTokens = segments
      .filter((segment) => segment.role !== 'system')
      .reduce((total, segment) => total + segment.tokenEstimate, 0)

    return { segments, steeringTokens, conversationTokens }
  }, [activeProjectLabel, activeSession?.messages, activeSession?.resources, systemPrompt])

  const contextBaseTokenEstimate =
    contextComposition.steeringTokens +
    contextComposition.conversationTokens +
    draftAttachmentTokenEstimate
  const contextDiagnostics = useMemo(
    () => ({
      cache: summarizePromptCacheStats(activeSession?.messages || []),
      tokenUsage: summarizeConversationTokenUsage(activeSession?.messages || []),
      messageCount: activeSession?.messages.length || 0,
      resourceCount: activeSession?.resources?.length || 0,
      hasSystemPrompt: systemPrompt.trim().length > 0,
      modelName: selectedModel,
      projectLabel: activeProjectLabel,
      customPermissionCount: Object.values(permissions || {}).filter((value) => value !== 'allow')
        .length,
      skillCount: skillsCount,
      contextWindowTokens,
      contextWindowSource: contextWindowInfo.source,
      conversationBaseTokens: contextComposition.conversationTokens + draftAttachmentTokenEstimate,
      steeringTokens: contextComposition.steeringTokens,
      mcpToolTokens: 0,
      compositionSegments: contextComposition.segments
    }),
    [
      activeProjectLabel,
      activeSession?.messages,
      activeSession?.resources,
      contextComposition.conversationTokens,
      contextComposition.segments,
      contextComposition.steeringTokens,
      contextWindowInfo.source,
      contextWindowTokens,
      draftAttachmentTokenEstimate,
      permissions,
      selectedModel,
      skillsCount,
      systemPrompt
    ]
  )

  return {
    activeModelContextWindowTokens,
    contextBaseTokenEstimate,
    contextDiagnostics
  }
}
