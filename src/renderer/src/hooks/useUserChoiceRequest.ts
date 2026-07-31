import { RefObject, useCallback, useEffect, useState } from 'react'
import { UserChoiceRequest, UserChoiceResponse } from '../../../shared/types'

interface UseUserChoiceRequestOptions {
  activeRequestId: string | null
  activeRequestIds: ReadonlySet<string>
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

interface UseUserChoiceRequestResult {
  pendingUserChoice: UserChoiceRequest | null
  handleUserChoiceResponse: (response: UserChoiceResponse) => void
}

export function useUserChoiceRequest({
  activeRequestId,
  activeRequestIds,
  textareaRef
}: UseUserChoiceRequestOptions): UseUserChoiceRequestResult {
  const [pendingByRequestId, setPendingByRequestId] = useState<
    ReadonlyMap<string, UserChoiceRequest>
  >(() => new Map())
  const pendingUserChoice = activeRequestId ? pendingByRequestId.get(activeRequestId) || null : null

  useEffect(() => {
    return window.api.onUserChoiceRequest((request) => {
      setPendingByRequestId((current) => {
        const next = new Map(current)
        next.set(request.reqId, request)
        return next
      })
    })
  }, [])

  useEffect(() => {
    setPendingByRequestId((current) => {
      const next = new Map(current)
      let changed = false
      for (const requestId of next.keys()) {
        if (activeRequestIds.has(requestId)) continue
        next.delete(requestId)
        changed = true
      }
      return changed ? next : current
    })
  }, [activeRequestIds])

  useEffect(() => {
    if (!pendingUserChoice) return
    const timeoutId = window.setTimeout(() => {
      textareaRef.current?.blur()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [pendingUserChoice, textareaRef])

  const handleUserChoiceResponse = useCallback(
    (response: UserChoiceResponse): void => {
      if (!pendingUserChoice) return

      window.api.respondUserChoice(pendingUserChoice.reqId, pendingUserChoice.requestId, response)
      setPendingByRequestId((current) => {
        const next = new Map(current)
        next.delete(pendingUserChoice.reqId)
        return next
      })
      window.setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
    },
    [pendingUserChoice, textareaRef]
  )

  return { pendingUserChoice, handleUserChoiceResponse }
}
