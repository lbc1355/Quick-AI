import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronUp, Paperclip } from 'lucide-react'

export interface StickyUserMessageItem {
  id: string
  preview: string
  filesCount: number
}

interface StickyUserMessageProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  userMessages: StickyUserMessageItem[]
  onSelectMessage: (messageId: string) => void
}

export const StickyUserMessage: React.FC<StickyUserMessageProps> = ({
  containerRef,
  userMessages,
  onSelectMessage
}) => {
  const [stickyMessageId, setStickyMessageId] = useState<string | null>(null)
  const stickyMessageIdRef = useRef<string | null>(null)

  const userMessageById = useMemo(() => {
    return new Map(userMessages.map((message) => [message.id, message]))
  }, [userMessages])
  const userMessageIdsKey = useMemo(
    () => userMessages.map((message) => message.id).join('\u001f'),
    [userMessages]
  )

  useEffect(() => {
    stickyMessageIdRef.current = stickyMessageId
  }, [stickyMessageId])

  useEffect(() => {
    const container = containerRef.current
    if (!container || userMessages.length === 0) {
      setStickyMessageId(null)
      return undefined
    }

    const updateStickyMessage = (): void => {
      const containerRect = container.getBoundingClientRect()
      const nodes = container.querySelectorAll<HTMLElement>(
        '[data-message-id][data-message-role="user"]'
      )
      let nextStickyId: string | null = null

      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index]
        const nodeRect = node.getBoundingClientRect()
        if (nodeRect.bottom < containerRect.top) {
          nextStickyId = node.dataset.messageId || null
          break
        }
      }

      if (nextStickyId !== stickyMessageIdRef.current) {
        stickyMessageIdRef.current = nextStickyId
        setStickyMessageId(nextStickyId)
      }
    }

    container.addEventListener('scroll', updateStickyMessage, { passive: true })
    const resizeObserver = new ResizeObserver(updateStickyMessage)
    resizeObserver.observe(container)
    const inner = container.firstElementChild
    if (inner instanceof HTMLElement) {
      resizeObserver.observe(inner)
    }

    const frameId = window.requestAnimationFrame(updateStickyMessage)
    return () => {
      container.removeEventListener('scroll', updateStickyMessage)
      resizeObserver.disconnect()
      window.cancelAnimationFrame(frameId)
    }
  }, [containerRef, userMessageIdsKey, userMessages.length])

  const stickyMessage = stickyMessageId ? userMessageById.get(stickyMessageId) : undefined
  const isVisible = Boolean(stickyMessage)

  return (
    <div className={`sticky-user-message-host ${isVisible ? 'visible' : ''}`}>
      {stickyMessage && (
        <button
          type="button"
          className="sticky-user-message"
          onClick={() => onSelectMessage(stickyMessage.id)}
          title={stickyMessage.preview}
          aria-label={`Back to user message: ${stickyMessage.preview}`}
        >
          <ChevronUp size={13} className="sticky-user-message-icon" />
          <span className="sticky-user-message-text">{stickyMessage.preview}</span>
          {stickyMessage.filesCount > 0 && (
            <span className="sticky-user-message-files">
              <Paperclip size={11} />
              {stickyMessage.filesCount}
            </span>
          )}
        </button>
      )}
    </div>
  )
}

StickyUserMessage.displayName = 'StickyUserMessage'
