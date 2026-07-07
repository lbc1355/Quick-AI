import { Message } from '../../../../shared/types'
import { RuntimeErrorPayload, normalizeRuntimeError } from '../../../../shared/runtimeErrors'

export const applyRuntimeErrorToMessage = (
  errorText: string,
  errorPayload?: RuntimeErrorPayload
): ((m: Message) => Message) => {
  const payload = errorPayload || normalizeRuntimeError(errorText, 'unknown')
  return (m) => {
    const currentEvents = m.agentEvents || []
    const hasEvents = currentEvents.length > 0
    return {
      ...m,
      content: errorText,
      isRuntimeError: true,
      errorPayload: payload,
      agentEvents: hasEvents
        ? [...currentEvents, { type: 'final', content: errorText }]
        : currentEvents
    }
  }
}
