export interface SessionGenerationState {
  isCurrentSessionGenerating: boolean
  isOtherSessionGenerating: boolean
}

export function getSessionGenerationState(
  isGenerating: boolean,
  activeGenerationSessionId: string | null,
  currentSessionId: string
): SessionGenerationState {
  return {
    isCurrentSessionGenerating: isGenerating && activeGenerationSessionId === currentSessionId,
    isOtherSessionGenerating:
      isGenerating &&
      activeGenerationSessionId !== null &&
      activeGenerationSessionId !== currentSessionId
  }
}
