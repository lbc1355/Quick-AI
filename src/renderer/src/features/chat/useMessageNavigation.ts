import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { Session } from '../../../../shared/types'

interface UseMessageNavigationArgs {
  activeSession: Session | null | undefined
  isCurrentSessionGenerating: boolean
}

const SCROLL_ALIGNMENT_MARGIN = 24
const LONG_SCROLL_DISTANCE = 16000
const RESTORE_DISTANCE_THRESHOLD = 60
const STREAM_SETTLE_MS = 150

const scrollPositionCache = new Map<string, number>()

const getAllMessageNodes = (container: HTMLDivElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'))

const getNavigationMessageNodes = (container: HTMLDivElement): HTMLElement[] =>
  getAllMessageNodes(container)

const findMessageNode = (container: HTMLDivElement, messageId: string): HTMLElement | undefined =>
  getAllMessageNodes(container).find((node) => node.dataset.messageId === messageId)

const getLastMessageId = (session: Session | null | undefined): string | null => {
  const messages = session?.messages || []
  return messages[messages.length - 1]?.id || null
}

const clampScrollTop = (container: HTMLDivElement, top: number): number => {
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
  return Math.min(maxTop, Math.max(0, top))
}

const getElementScrollTop = (
  container: HTMLDivElement,
  target: HTMLElement,
  block: 'center' | 'start' = 'center'
): number => {
  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetTop = targetRect.top - containerRect.top + container.scrollTop

  if (block === 'start' || targetRect.height > container.clientHeight * 0.72) {
    return clampScrollTop(container, targetTop - SCROLL_ALIGNMENT_MARGIN)
  }

  const centerOffset = Math.max(
    SCROLL_ALIGNMENT_MARGIN,
    (container.clientHeight - targetRect.height) / 2
  )
  return clampScrollTop(container, targetTop - centerOffset)
}

const getBottomScrollTop = (container: HTMLDivElement): number =>
  Math.max(0, container.scrollHeight - container.clientHeight)

const getDistanceFromBottom = (container: HTMLDivElement): number =>
  Math.max(0, container.scrollHeight - container.scrollTop - container.clientHeight)

const getRestoredScrollTop = (container: HTMLDivElement, distanceFromBottom: number): number =>
  clampScrollTop(container, container.scrollHeight - container.clientHeight - distanceFromBottom)

const scrollContainerTo = (
  container: HTMLDivElement,
  top: number,
  behavior: ScrollBehavior
): { behavior: ScrollBehavior; resetDelay: number; correctionDelays: number[] } => {
  const distance = Math.abs(container.scrollTop - top)
  const effectiveBehavior: ScrollBehavior =
    behavior === 'smooth' && distance <= LONG_SCROLL_DISTANCE ? 'smooth' : 'auto'

  container.scrollTo({ top, behavior: effectiveBehavior })

  return effectiveBehavior === 'smooth'
    ? { behavior: effectiveBehavior, resetDelay: 420, correctionDelays: [] }
    : { behavior: effectiveBehavior, resetDelay: 90, correctionDelays: [40] }
}

const scheduleScrollCorrections = (
  container: HTMLDivElement,
  getTop: () => number,
  delays: number[]
): void => {
  delays.forEach((delay) => {
    window.setTimeout(() => {
      if (!container.isConnected) return
      const top = getTop()
      if (Math.abs(container.scrollTop - top) > 2) {
        container.scrollTo({ top, behavior: 'auto' })
      }
    }, delay)
  })
}

export function useMessageNavigation({
  activeSession,
  isCurrentSessionGenerating
}: UseMessageNavigationArgs): {
  messagesEndRef: RefObject<HTMLDivElement | null>
  messagesContainerRef: RefObject<HTMLDivElement | null>
  messagesInnerRef: RefObject<HTMLDivElement | null>
  showScrollToBottom: boolean
  activeMessageNavId: string | null
  pendingScrollMessageId: string | null
  setPendingScrollMessageId: Dispatch<SetStateAction<string | null>>
  scrollToBottom: (behavior?: ScrollBehavior) => void
  scrollToMessage: (messageId: string) => void
  handleScroll: () => void
} {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesInnerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const isProgrammaticScrollRef = useRef(false)
  const activeSessionIdRef = useRef<string | null>(activeSession?.id ?? null)
  const restoredSessionIdRef = useRef<string | null>(null)
  const wasGeneratingRef = useRef(isCurrentSessionGenerating)
  const streamSettlingRef = useRef(false)
  const streamSettlingTimeoutRef = useRef<number | null>(null)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [activeMessageNavId, setActiveMessageNavId] = useState<string | null>(null)
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState<string | null>(null)

  useEffect(() => {
    activeSessionIdRef.current = activeSession?.id ?? null
  }, [activeSession?.id])

  const saveScrollPosition = useCallback((container: HTMLDivElement): void => {
    const sessionId = activeSessionIdRef.current
    if (!sessionId) return
    scrollPositionCache.set(sessionId, getDistanceFromBottom(container))
  }, [])

  useEffect(() => {
    const sessionId = activeSession?.id
    restoredSessionIdRef.current = null
    setActiveMessageNavId(null)
    if (!sessionId) {
      shouldAutoScrollRef.current = true
      setShowScrollToBottom(false)
      return
    }

    const savedDistance = scrollPositionCache.get(sessionId)
    const shouldRestore = savedDistance !== undefined && savedDistance > RESTORE_DISTANCE_THRESHOLD
    shouldAutoScrollRef.current = !shouldRestore
    setShowScrollToBottom(shouldRestore)
  }, [activeSession?.id])

  useEffect(() => {
    const wasGenerating = wasGeneratingRef.current
    wasGeneratingRef.current = isCurrentSessionGenerating

    if (streamSettlingTimeoutRef.current !== null) {
      window.clearTimeout(streamSettlingTimeoutRef.current)
      streamSettlingTimeoutRef.current = null
    }

    if (wasGenerating && !isCurrentSessionGenerating) {
      streamSettlingRef.current = true
      streamSettlingTimeoutRef.current = window.setTimeout(() => {
        streamSettlingRef.current = false
        streamSettlingTimeoutRef.current = null
      }, STREAM_SETTLE_MS)
    } else if (isCurrentSessionGenerating) {
      streamSettlingRef.current = false
    }

    return () => {
      if (streamSettlingTimeoutRef.current !== null) {
        window.clearTimeout(streamSettlingTimeoutRef.current)
        streamSettlingTimeoutRef.current = null
      }
    }
  }, [isCurrentSessionGenerating])

  useEffect(() => {
    if (isCurrentSessionGenerating) {
      shouldAutoScrollRef.current = true
      setShowScrollToBottom(false)
    }
  }, [isCurrentSessionGenerating])

  const updateMessageNavigationState = useCallback((container: HTMLDivElement): void => {
    const messageNodes = getNavigationMessageNodes(container)
    if (messageNodes.length === 0) {
      setActiveMessageNavId(null)
      return
    }

    const threshold = 60
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <= threshold

    if (isAtBottom) {
      setActiveMessageNavId(messageNodes[messageNodes.length - 1].dataset.messageId || null)
      return
    }

    const containerTop = container.getBoundingClientRect().top
    const targetY = containerTop + Math.min(Math.max(container.clientHeight * 0.28, 120), 240)
    const activeNode =
      messageNodes.find((node) => node.getBoundingClientRect().bottom >= targetY) || messageNodes[0]

    setActiveMessageNavId(activeNode.dataset.messageId || null)
  }, [])

  const finishProgrammaticScroll = useCallback(
    (container: HTMLDivElement, delay: number, after?: () => void): void => {
      window.setTimeout(() => {
        isProgrammaticScrollRef.current = false
        after?.()
        if (container.isConnected) {
          const isAtBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight <= 60
          shouldAutoScrollRef.current = isAtBottom
          setShowScrollToBottom(!isAtBottom)
          saveScrollPosition(container)
          updateMessageNavigationState(container)
        }
      }, delay)
    },
    [saveScrollPosition, updateMessageNavigationState]
  )

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto'): void => {
      const container = messagesContainerRef.current
      if (!container) return

      shouldAutoScrollRef.current = true
      setShowScrollToBottom(false)
      setActiveMessageNavId(getLastMessageId(activeSession))
      isProgrammaticScrollRef.current = true

      const getTop = (): number => getBottomScrollTop(container)
      const result = scrollContainerTo(container, getTop(), behavior)
      scheduleScrollCorrections(container, getTop, result.correctionDelays)
      finishProgrammaticScroll(container, result.resetDelay)
    },
    [activeSession, finishProgrammaticScroll]
  )

  const scrollToMessage = useCallback(
    (messageId: string): void => {
      const container = messagesContainerRef.current
      if (!container) return

      const target = findMessageNode(container, messageId)
      if (!target) return

      shouldAutoScrollRef.current = false
      setShowScrollToBottom(true)
      setActiveMessageNavId(messageId)
      isProgrammaticScrollRef.current = true

      const block = target.offsetHeight > container.clientHeight * 0.72 ? 'start' : 'center'
      const getTop = (): number => getElementScrollTop(container, target, block)
      const result = scrollContainerTo(container, getTop(), 'smooth')
      scheduleScrollCorrections(container, getTop, result.correctionDelays)

      finishProgrammaticScroll(container, result.resetDelay, () => {
        setActiveMessageNavId(messageId)
      })
    },
    [finishProgrammaticScroll]
  )

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      const container = messagesContainerRef.current
      if (container) {
        setActiveMessageNavId(getLastMessageId(activeSession))
        const behavior = isCurrentSessionGenerating || streamSettlingRef.current ? 'auto' : 'smooth'
        isProgrammaticScrollRef.current = true
        const getTop = (): number => getBottomScrollTop(container)
        const result = scrollContainerTo(container, getTop(), behavior)
        scheduleScrollCorrections(container, getTop, result.correctionDelays)
        setShowScrollToBottom(false)
        const timeoutId = window.setTimeout(() => {
          isProgrammaticScrollRef.current = false
          saveScrollPosition(container)
          updateMessageNavigationState(container)
        }, result.resetDelay)
        return () => clearTimeout(timeoutId)
      }
    }
    return undefined
  }, [activeSession, isCurrentSessionGenerating, saveScrollPosition, updateMessageNavigationState])

  useLayoutEffect(() => {
    const sessionId = activeSession?.id
    if (!sessionId || restoredSessionIdRef.current === sessionId) return undefined

    const savedDistance = scrollPositionCache.get(sessionId)
    if (savedDistance === undefined || savedDistance <= RESTORE_DISTANCE_THRESHOLD) {
      restoredSessionIdRef.current = sessionId
      return undefined
    }

    const container = messagesContainerRef.current
    if (!container) return undefined

    restoredSessionIdRef.current = sessionId
    shouldAutoScrollRef.current = false
    setShowScrollToBottom(true)
    isProgrammaticScrollRef.current = true

    const restore = (): void => {
      if (!container.isConnected) return
      container.scrollTop = getRestoredScrollTop(container, savedDistance)
      updateMessageNavigationState(container)
    }

    restore()
    const rafId = window.requestAnimationFrame(() => {
      restore()
      window.setTimeout(() => {
        if (!container.isConnected) return
        restore()
        isProgrammaticScrollRef.current = false
        saveScrollPosition(container)
      }, 40)
    })

    return () => window.cancelAnimationFrame(rafId)
  }, [
    activeSession?.id,
    activeSession?.messages.length,
    saveScrollPosition,
    updateMessageNavigationState
  ])

  useEffect(() => {
    if (!pendingScrollMessageId) return

    const container = messagesContainerRef.current
    const target = container ? findMessageNode(container, pendingScrollMessageId) : undefined
    if (!container || !target) return

    shouldAutoScrollRef.current = false
    setActiveMessageNavId(pendingScrollMessageId)
    isProgrammaticScrollRef.current = true

    const block = target.offsetHeight > container.clientHeight * 0.72 ? 'start' : 'center'
    const getTop = (): number => getElementScrollTop(container, target, block)
    const result = scrollContainerTo(container, getTop(), 'auto')
    scheduleScrollCorrections(container, getTop, result.correctionDelays)

    const timeoutId = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false
      setPendingScrollMessageId(null)
      saveScrollPosition(container)
      updateMessageNavigationState(container)
    }, result.resetDelay)
    return () => clearTimeout(timeoutId)
  }, [
    activeSession?.id,
    activeSession?.messages.length,
    pendingScrollMessageId,
    saveScrollPosition,
    updateMessageNavigationState
  ])

  useEffect(() => {
    const container = messagesContainerRef.current
    const inner = messagesInnerRef.current
    if (!container || !inner) return undefined

    const observer = new ResizeObserver(() => {
      if (
        shouldAutoScrollRef.current &&
        (isCurrentSessionGenerating || streamSettlingRef.current)
      ) {
        isProgrammaticScrollRef.current = true
        container.scrollTop = getBottomScrollTop(container)
        const messageNodes = getNavigationMessageNodes(container)
        setActiveMessageNavId(messageNodes[messageNodes.length - 1]?.dataset.messageId || null)
        setTimeout(() => {
          isProgrammaticScrollRef.current = false
          saveScrollPosition(container)
        }, 60)
      }
    })

    observer.observe(inner)
    return () => observer.disconnect()
  }, [activeSession?.id, isCurrentSessionGenerating, saveScrollPosition])

  const handleScroll = useCallback((): void => {
    const container = messagesContainerRef.current
    if (!container) return

    if (isProgrammaticScrollRef.current) return

    const threshold = 60
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <= threshold

    if (isAtBottom) {
      shouldAutoScrollRef.current = true
      setShowScrollToBottom(false)
    } else {
      shouldAutoScrollRef.current = false
      setShowScrollToBottom(true)
    }

    saveScrollPosition(container)
    updateMessageNavigationState(container)
  }, [saveScrollPosition, updateMessageNavigationState])

  return {
    messagesEndRef,
    messagesContainerRef,
    messagesInnerRef,
    showScrollToBottom,
    activeMessageNavId,
    pendingScrollMessageId,
    setPendingScrollMessageId,
    scrollToBottom,
    scrollToMessage,
    handleScroll
  }
}
