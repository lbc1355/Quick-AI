import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
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

const getAllMessageNodes = (container: HTMLDivElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'))

const getNavigationMessageNodes = (container: HTMLDivElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-message-id][data-message-role="user"]'))

const findMessageNode = (container: HTMLDivElement, messageId: string): HTMLElement | undefined =>
  getAllMessageNodes(container).find((node) => node.dataset.messageId === messageId)

const getLastUserMessageId = (session: Session | null | undefined): string | null => {
  const messages = session?.messages || []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return messages[index].id
  }
  return null
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
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [activeMessageNavId, setActiveMessageNavId] = useState<string | null>(null)
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState<string | null>(null)

  useEffect(() => {
    shouldAutoScrollRef.current = true
    setShowScrollToBottom(false)
    setActiveMessageNavId(null)
  }, [activeSession?.id])

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
          updateMessageNavigationState(container)
        }
      }, delay)
    },
    [updateMessageNavigationState]
  )

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto'): void => {
      const container = messagesContainerRef.current
      if (!container) return

      shouldAutoScrollRef.current = true
      setShowScrollToBottom(false)
      setActiveMessageNavId(getLastUserMessageId(activeSession))
      isProgrammaticScrollRef.current = true

      const getTop = () => getBottomScrollTop(container)
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
      if (target.dataset.messageRole === 'user') {
        setActiveMessageNavId(messageId)
      }
      isProgrammaticScrollRef.current = true

      const block = target.offsetHeight > container.clientHeight * 0.72 ? 'start' : 'center'
      const getTop = () => getElementScrollTop(container, target, block)
      const result = scrollContainerTo(container, getTop(), 'auto')
      scheduleScrollCorrections(container, getTop, result.correctionDelays)

      finishProgrammaticScroll(container, result.resetDelay, () => {
        if (target.dataset.messageRole === 'user') {
          setActiveMessageNavId(messageId)
        }
      })
    },
    [finishProgrammaticScroll]
  )

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      const container = messagesContainerRef.current
      if (container) {
        setActiveMessageNavId(getLastUserMessageId(activeSession))
        const behavior = isCurrentSessionGenerating ? 'auto' : 'smooth'
        isProgrammaticScrollRef.current = true
        const getTop = () => getBottomScrollTop(container)
        const result = scrollContainerTo(container, getTop(), behavior)
        scheduleScrollCorrections(container, getTop, result.correctionDelays)
        setShowScrollToBottom(false)
        const timeoutId = window.setTimeout(() => {
          isProgrammaticScrollRef.current = false
          updateMessageNavigationState(container)
        }, result.resetDelay)
        return () => clearTimeout(timeoutId)
      }
    }
    return undefined
  }, [activeSession, isCurrentSessionGenerating, updateMessageNavigationState])

  useEffect(() => {
    if (!pendingScrollMessageId) return

    const container = messagesContainerRef.current
    const target = container ? findMessageNode(container, pendingScrollMessageId) : undefined
    if (!container || !target) return

    shouldAutoScrollRef.current = false
    if (target.dataset.messageRole === 'user') {
      setActiveMessageNavId(pendingScrollMessageId)
    }
    isProgrammaticScrollRef.current = true

    const block = target.offsetHeight > container.clientHeight * 0.72 ? 'start' : 'center'
    const getTop = () => getElementScrollTop(container, target, block)
    const result = scrollContainerTo(container, getTop(), 'auto')
    scheduleScrollCorrections(container, getTop, result.correctionDelays)

    const timeoutId = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false
      setPendingScrollMessageId(null)
      updateMessageNavigationState(container)
    }, result.resetDelay)
    return () => clearTimeout(timeoutId)
  }, [
    activeSession?.id,
    activeSession?.messages.length,
    pendingScrollMessageId,
    updateMessageNavigationState
  ])

  useEffect(() => {
    const container = messagesContainerRef.current
    const inner = messagesInnerRef.current
    if (!container || !inner) return undefined

    const observer = new ResizeObserver(() => {
      if (shouldAutoScrollRef.current && isCurrentSessionGenerating) {
        isProgrammaticScrollRef.current = true
        container.scrollTop = getBottomScrollTop(container)
        const messageNodes = getNavigationMessageNodes(container)
        setActiveMessageNavId(messageNodes[messageNodes.length - 1]?.dataset.messageId || null)
        setTimeout(() => {
          isProgrammaticScrollRef.current = false
        }, 60)
      }
    })

    observer.observe(inner)
    return () => observer.disconnect()
  }, [activeSession?.id, isCurrentSessionGenerating])

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

    updateMessageNavigationState(container)
  }, [updateMessageNavigationState])

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
