import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import type { Session } from '../../../../shared/types'
import { getPopupOptions } from '../../utils/autocompleteHelpers'
import type { PendingPermission, PermissionResponsePayload } from './permissionTypes'

function findPendingPermission(
  activeSession: Session | null | undefined
): PendingPermission | null {
  if (!activeSession) return null
  for (let i = activeSession.messages.length - 1; i >= 0; i--) {
    const msg = activeSession.messages[i]
    if (!msg.agentEvents) continue
    const pendingEvent = msg.agentEvents.find(
      (event) => event.type === 'tool_call' && event.permissionState === 'pending'
    )
    if (pendingEvent?.type === 'tool_call') {
      return {
        msgId: msg.id,
        agentRunId: msg.agentRunId || '',
        callId: pendingEvent.callId,
        toolName: pendingEvent.toolName,
        args: pendingEvent.args
      }
    }
  }
  return null
}

interface PermissionPopupControllerOptions {
  activeSession: Session | null | undefined
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export function usePermissionPopupController({
  activeSession,
  textareaRef
}: PermissionPopupControllerOptions): {
  pendingPermission: PendingPermission | null
  selectedOptionIndex: number
  handlePermissionResponse: (payload: PermissionResponsePayload) => void
} {
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0)
  const [prevCallId, setPrevCallId] = useState<string | null>(null)

  const pendingPermission = useMemo(() => findPendingPermission(activeSession), [activeSession])
  const pendingCallId = pendingPermission?.callId || null

  useEffect(() => {
    if (pendingCallId === prevCallId) return
    setPrevCallId(pendingCallId)
    setSelectedOptionIndex(0)
  }, [pendingCallId, prevCallId])

  const handlePermissionResponse = useCallback(
    (payload: PermissionResponsePayload): void => {
      if (!pendingPermission) return
      window.api.respondToolPermission(
        pendingPermission.agentRunId,
        pendingPermission.callId,
        payload
      )
      window.setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
    },
    [pendingPermission, textareaRef]
  )

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent): void => {
      if (!pendingPermission) return

      const options = getPopupOptions(pendingPermission)
      if (options.length === 0) return

      const num = parseInt(event.key, 10)
      if (!Number.isNaN(num) && num >= 1 && num <= options.length) {
        event.preventDefault()
        handlePermissionResponse(options[num - 1].payload)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedOptionIndex((prev) => (prev - 1 + options.length) % options.length)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedOptionIndex((prev) => (prev + 1) % options.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (options[selectedOptionIndex]) {
          handlePermissionResponse(options[selectedOptionIndex].payload)
        }
      } else if (event.key === 'Escape') {
        event.preventDefault()
        const denyOption = options.find((option) => {
          if (typeof option.payload === 'boolean') return !option.payload
          return !option.payload.approved
        })
        handlePermissionResponse(denyOption ? denyOption.payload : false)
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown)
    }
  }, [handlePermissionResponse, pendingPermission, selectedOptionIndex])

  return { pendingPermission, selectedOptionIndex, handlePermissionResponse }
}
