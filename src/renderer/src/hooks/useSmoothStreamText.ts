import { useEffect, useRef, useState } from 'react'

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
) => {
  segment(input: string): Iterable<{ segment: string }>
}

const getSegmenter = (): SegmenterConstructor | undefined => {
  return (Intl as typeof Intl & { Segmenter?: SegmenterConstructor }).Segmenter
}

export const segmentGraphemes = (text: string): string[] => {
  if (!text) return []

  const Segmenter = getSegmenter()
  if (!Segmenter) return Array.from(text)

  return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => {
    return part.segment
  })
}

export const getSmoothStreamBatchSize = (queueLength: number): number => {
  if (queueLength > 800) return 96
  if (queueLength > 400) return 56
  if (queueLength > 180) return 32
  if (queueLength > 80) return 18
  if (queueLength > 24) return 8
  return 3
}

const scheduleFrame = (callback: () => void): number => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback)
  }
  return globalThis.setTimeout(callback, 16) as unknown as number
}

const cancelFrame = (id: number): void => {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(id)
    return
  }
  globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>)
}

export const useSmoothStreamText = (targetText: string, active: boolean): string => {
  const [displayedText, setDisplayedText] = useState(targetText)
  const previousTargetRef = useRef(targetText)
  const displayedRef = useRef(targetText)
  const queueRef = useRef<string[]>([])
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    displayedRef.current = displayedText
  }, [displayedText])

  useEffect(() => {
    if (!active) {
      if (frameRef.current !== null) {
        cancelFrame(frameRef.current)
        frameRef.current = null
      }
      queueRef.current = []
      previousTargetRef.current = targetText
      displayedRef.current = targetText
      setDisplayedText(targetText)
      return undefined
    }

    const previousTarget = previousTargetRef.current
    if (targetText === previousTarget) return undefined

    if (!targetText.startsWith(previousTarget)) {
      queueRef.current = []
      previousTargetRef.current = targetText
      displayedRef.current = targetText
      setDisplayedText(targetText)
      return undefined
    }

    queueRef.current.push(...segmentGraphemes(targetText.slice(previousTarget.length)))
    previousTargetRef.current = targetText

    const flush = (): void => {
      frameRef.current = null
      const queue = queueRef.current

      if (queue.length === 0) {
        if (displayedRef.current !== previousTargetRef.current) {
          displayedRef.current = previousTargetRef.current
          setDisplayedText(previousTargetRef.current)
        }
        return
      }

      const take = Math.min(getSmoothStreamBatchSize(queue.length), queue.length)
      const chunk = queue.splice(0, take).join('')
      const nextDisplayed = displayedRef.current + chunk
      displayedRef.current = nextDisplayed
      setDisplayedText(nextDisplayed)

      if (queue.length > 0) {
        frameRef.current = scheduleFrame(flush)
      }
    }

    if (frameRef.current === null) {
      frameRef.current = scheduleFrame(flush)
    }

    return undefined
  }, [active, targetText])

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelFrame(frameRef.current)
      }
    }
  }, [])

  return displayedText
}
