import { RefObject, useCallback, useEffect, useState } from 'react'
import { UserChoiceRequest, UserChoiceResponse } from '../../../shared/types'

interface UseUserChoiceRequestOptions {
  isGenerating: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

interface UseUserChoiceRequestResult {
  pendingUserChoice: UserChoiceRequest | null
  handleUserChoiceResponse: (response: UserChoiceResponse) => void
}

export function useUserChoiceRequest({
  isGenerating,
  textareaRef
}: UseUserChoiceRequestOptions): UseUserChoiceRequestResult {
  const [pendingUserChoice, setPendingUserChoice] = useState<UserChoiceRequest | null>(null)

  useEffect(() => {
    return window.api.onUserChoiceRequest((request) => {
      setPendingUserChoice(request)
      window.setTimeout(() => {
        textareaRef.current?.blur()
      }, 0)
    })
  }, [textareaRef])

  useEffect(() => {
    if (isGenerating || !pendingUserChoice) return undefined

    const timeoutId = window.setTimeout(() => {
      setPendingUserChoice(null)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [isGenerating, pendingUserChoice])

  const handleUserChoiceResponse = useCallback(
    (response: UserChoiceResponse): void => {
      if (!pendingUserChoice) return

      window.api.respondUserChoice(pendingUserChoice.reqId, pendingUserChoice.requestId, response)
      setPendingUserChoice(null)
      window.setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
    },
    [pendingUserChoice, textareaRef]
  )

  return { pendingUserChoice, handleUserChoiceResponse }
}
