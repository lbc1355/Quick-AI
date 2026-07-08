import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { Message } from '../../../../shared/types'

const VIRTUALIZATION_THRESHOLD = 80
export const VIRTUAL_MESSAGE_GAP = 18

const DEFAULT_MESSAGE_HEIGHT = 156
const MIN_MESSAGE_HEIGHT = 48
const OVERSCAN_PX = 900

interface VirtualizedMessagesArgs {
  messages: Message[]
  containerRef: RefObject<HTMLDivElement | null>
  innerRef: RefObject<HTMLDivElement | null>
}

interface VirtualizedMessagesResult {
  isVirtualized: boolean
  startIndex: number
  endIndex: number
  firstVisibleIndex: number
  visibleMessages: Array<{ message: Message; index: number }>
  topSpacerHeight: number
  bottomSpacerHeight: number
  getEstimatedMessageTop: (messageId: string) => number | null
}

export interface VirtualMessageOffsets {
  offsets: number[]
  totalHeight: number
}

export const buildVirtualMessageOffsets = (
  messages: Message[],
  measuredHeights: ReadonlyMap<string, number>,
  averageHeight: number
): VirtualMessageOffsets => {
  const offsets = new Array<number>(messages.length + 1)
  offsets[0] = 0

  for (let index = 0; index < messages.length; index += 1) {
    const measuredHeight = measuredHeights.get(messages[index].id)
    const height = Math.max(MIN_MESSAGE_HEIGHT, measuredHeight ?? averageHeight)
    const gap = index < messages.length - 1 ? VIRTUAL_MESSAGE_GAP : 0
    offsets[index + 1] = offsets[index] + height + gap
  }

  return {
    offsets,
    totalHeight: offsets[messages.length] ?? 0
  }
}

export const findVirtualMessageRange = (
  offsets: number[],
  totalMessages: number,
  scrollTop: number,
  viewportHeight: number
): { startIndex: number; endIndex: number } => {
  if (totalMessages === 0) {
    return { startIndex: 0, endIndex: 0 }
  }

  const viewportStart = Math.max(0, scrollTop - OVERSCAN_PX)
  const viewportEnd = scrollTop + Math.max(viewportHeight, 1) + OVERSCAN_PX

  let startIndex = 0
  while (startIndex < totalMessages - 1 && offsets[startIndex + 1] < viewportStart) {
    startIndex += 1
  }

  let endIndex = startIndex
  while (endIndex < totalMessages && offsets[endIndex] <= viewportEnd) {
    endIndex += 1
  }

  return {
    startIndex,
    endIndex: Math.min(totalMessages, Math.max(endIndex, startIndex + 1))
  }
}

export const findVirtualMessageIndex = (
  offsets: number[],
  totalMessages: number,
  scrollTop: number
): number => {
  if (totalMessages === 0) return 0

  let index = 0
  while (index < totalMessages - 1 && offsets[index + 1] < scrollTop) {
    index += 1
  }

  return index
}

export const useVirtualizedMessages = ({
  messages,
  containerRef,
  innerRef
}: VirtualizedMessagesArgs): VirtualizedMessagesResult => {
  const isVirtualized = messages.length > VIRTUALIZATION_THRESHOLD
  const [measuredHeights, setMeasuredHeights] = useState<Map<string, number>>(() => new Map())
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 })

  const averageHeight = useMemo(() => {
    const heights = Array.from(measuredHeights.values())
    if (heights.length === 0) return DEFAULT_MESSAGE_HEIGHT
    const total = heights.reduce((sum, height) => sum + height, 0)
    return Math.max(MIN_MESSAGE_HEIGHT, total / heights.length)
  }, [measuredHeights])

  const { offsets, totalHeight } = useMemo(
    () => buildVirtualMessageOffsets(messages, measuredHeights, averageHeight),
    [averageHeight, measuredHeights, messages]
  )

  const updateViewport = useCallback((): void => {
    const container = containerRef.current
    if (!container) return
    setViewport((current) => {
      const next = {
        scrollTop: container.scrollTop,
        height: container.clientHeight
      }

      if (current.scrollTop === next.scrollTop && current.height === next.height) {
        return current
      }

      return next
    })
  }, [containerRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    updateViewport()
    container.addEventListener('scroll', updateViewport, { passive: true })
    const resizeObserver = new ResizeObserver(updateViewport)
    resizeObserver.observe(container)

    return () => {
      container.removeEventListener('scroll', updateViewport)
      resizeObserver.disconnect()
    }
  }, [containerRef, updateViewport])

  const range = useMemo(() => {
    if (!isVirtualized) {
      return { startIndex: 0, endIndex: messages.length }
    }

    return findVirtualMessageRange(offsets, messages.length, viewport.scrollTop, viewport.height)
  }, [isVirtualized, messages.length, offsets, viewport.height, viewport.scrollTop])
  const firstVisibleIndex = useMemo(
    () =>
      isVirtualized
        ? findVirtualMessageIndex(offsets, messages.length, viewport.scrollTop)
        : range.startIndex,
    [isVirtualized, messages.length, offsets, range.startIndex, viewport.scrollTop]
  )

  const visibleMessages = useMemo(
    () =>
      messages.slice(range.startIndex, range.endIndex).map((message, offset) => ({
        message,
        index: range.startIndex + offset
      })),
    [messages, range.endIndex, range.startIndex]
  )

  useLayoutEffect(() => {
    if (!isVirtualized) return

    const inner = innerRef.current
    if (!inner) return

    setMeasuredHeights((currentHeights) => {
      let nextHeights: Map<string, number> | null = null

      inner.querySelectorAll<HTMLElement>('[data-virtual-message-id]').forEach((node) => {
        const messageId = node.dataset.virtualMessageId
        if (!messageId) return

        const nextHeight = Math.max(MIN_MESSAGE_HEIGHT, node.getBoundingClientRect().height)
        const previousHeight = (nextHeights ?? currentHeights).get(messageId)
        if (previousHeight === undefined || Math.abs(previousHeight - nextHeight) > 1) {
          nextHeights = nextHeights ?? new Map(currentHeights)
          nextHeights.set(messageId, nextHeight)
        }
      })

      return nextHeights ?? currentHeights
    })
  }, [innerRef, isVirtualized, messages, range.endIndex, range.startIndex])

  useEffect(() => {
    const messageIds = new Set(messages.map((message) => message.id))
    setMeasuredHeights((currentHeights) => {
      let nextHeights: Map<string, number> | null = null
      currentHeights.forEach((_, messageId) => {
        if (!messageIds.has(messageId)) {
          nextHeights = nextHeights ?? new Map(currentHeights)
          nextHeights.delete(messageId)
        }
      })

      return nextHeights ?? currentHeights
    })
  }, [messages])

  const getEstimatedMessageTop = useCallback(
    (messageId: string): number | null => {
      const index = messages.findIndex((message) => message.id === messageId)
      if (index === -1) return null
      return offsets[index] ?? null
    },
    [messages, offsets]
  )

  if (!isVirtualized) {
    return {
      isVirtualized,
      startIndex: 0,
      endIndex: messages.length,
      firstVisibleIndex: 0,
      visibleMessages,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      getEstimatedMessageTop
    }
  }

  return {
    isVirtualized,
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    firstVisibleIndex,
    visibleMessages,
    topSpacerHeight: offsets[range.startIndex] ?? 0,
    bottomSpacerHeight: Math.max(0, totalHeight - (offsets[range.endIndex] ?? totalHeight)),
    getEstimatedMessageTop
  }
}
