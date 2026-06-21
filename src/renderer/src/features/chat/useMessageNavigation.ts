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
  scrollToMessage: (messageId: string, isLastMessage?: boolean) => void
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
    const messageNodes = Array.from(
      container.querySelectorAll<HTMLElement>('[data-message-id]')
    )
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
      messageNodes.find((node) => node.getBoundingClientRect().bottom >= targetY) ||
      messageNodes[0]

    setActiveMessageNavId(activeNode.dataset.messageId || null)
  }, [])

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth'): void => {
      const container = messagesContainerRef.current
      if (!container) return

      shouldAutoScrollRef.current = true
      setShowScrollToBottom(false)
      const lastMessage = activeSession?.messages[activeSession.messages.length - 1]
      setActiveMessageNavId(lastMessage?.id || null)
      isProgrammaticScrollRef.current = true
      container.scrollTo({
        top: container.scrollHeight,
        behavior
      })

      const resetDelay = behavior === 'smooth' ? 500 : 60
      window.setTimeout(() => {
        isProgrammaticScrollRef.current = false
      }, resetDelay)
    },
    [activeSession?.messages]
  )

  const scrollToMessage = useCallback(
    (messageId: string, isLastMessage = false): void => {
      if (isLastMessage) {
        scrollToBottom('smooth')
        return
      }

      const container = messagesContainerRef.current
      if (!container) return

      const target = Array.from(
        container.querySelectorAll<HTMLElement>('[data-message-id]')
      ).find((node) => node.dataset.messageId === messageId)
      if (!target) return

      shouldAutoScrollRef.current = false
      setShowScrollToBottom(true)
      setActiveMessageNavId(messageId)
      isProgrammaticScrollRef.current = true
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })

      window.setTimeout(() => {
        isProgrammaticScrollRef.current = false
        updateMessageNavigationState(container)
      }, 500)
    },
    [scrollToBottom, updateMessageNavigationState]
  )

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      const container = messagesContainerRef.current
      if (container) {
        const lastMessage = activeSession?.messages[activeSession.messages.length - 1]
        setActiveMessageNavId(lastMessage?.id || null)
        const behavior = isCurrentSessionGenerating ? 'auto' : 'smooth'
        if (behavior === 'smooth') {
          isProgrammaticScrollRef.current = true
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
          })
          const timeoutId = setTimeout(() => {
            isProgrammaticScrollRef.current = false
          }, 500)
          setShowScrollToBottom(false)
          return () => clearTimeout(timeoutId)
        } else {
          container.scrollTop = container.scrollHeight
          setShowScrollToBottom(false)
        }
      }
    }
    return undefined
  }, [activeSession?.id, activeSession?.messages, isCurrentSessionGenerating])

  useEffect(() => {
    if (!pendingScrollMessageId) return

    const container = messagesContainerRef.current
    const target = container?.querySelector<HTMLElement>(
      `[data-message-id="${pendingScrollMessageId}"]`
    )
    if (!target) return

    shouldAutoScrollRef.current = false
    setActiveMessageNavId(pendingScrollMessageId)
    isProgrammaticScrollRef.current = true
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })

    const timeoutId = setTimeout(() => {
      isProgrammaticScrollRef.current = false
      setPendingScrollMessageId(null)
    }, 500)
    return () => clearTimeout(timeoutId)
  }, [activeSession?.id, activeSession?.messages.length, pendingScrollMessageId])

  useEffect(() => {
    const container = messagesContainerRef.current
    const inner = messagesInnerRef.current
    if (!container || !inner) return undefined

    const observer = new ResizeObserver(() => {
      if (shouldAutoScrollRef.current && isCurrentSessionGenerating) {
        isProgrammaticScrollRef.current = true
        container.scrollTop = container.scrollHeight
        const messageNodes = Array.from(
          container.querySelectorAll<HTMLElement>('[data-message-id]')
        )
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
