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

/**
 * Past this length a target is rendered in full immediately — animating a 180k-char compaction
 * transcript frame by frame would take tens of seconds for no benefit.
 */
const SMOOTH_STREAM_MAX_CHARS = 8000

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

/**
 * Number of graphemes visible after one smooth-stream frame, given how many are already shown and
 * how many the target contains. Short queues advance one grapheme at a time for a typewriter feel;
 * long queues advance in larger batches so the display catches up quickly.
 */
export const getNextShownLength = (shown: number, targetLen: number): number => {
  if (targetLen === 0) return 0
  if (shown >= targetLen) return targetLen
  return Math.min(targetLen, shown + getSmoothStreamBatchSize(targetLen - shown))
}

/**
 * Renders `targetText` with a typewriter effect: each animation frame reveals a few more graphemes
 * until the whole target is visible. This keeps a streaming feel even when the text arrives in one
 * jump — an agent's final answer is emitted as a single `final` event right before `done`, so the
 * caller's `active` flag is already false by the time it renders. The reveal therefore manages its
 * own lifecycle: once unseen content appears, it animates to the end whether or not `active`
 * stays true; `active` only matters for content that is already fully shown (history / settled),
 * which renders as-is. Targets above {@link SMOOTH_STREAM_MAX_CHARS} skip the animation.
 */
export const useSmoothStreamText = (targetText: string, active: boolean): string => {
  const [displayedText, setDisplayedText] = useState(targetText)
  const targetRef = useRef(targetText)
  const graphemesRef = useRef<string[]>(segmentGraphemes(targetText))
  const shownLenRef = useRef(graphemesRef.current.length)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const prevTarget = targetRef.current
    targetRef.current = targetText
    graphemesRef.current = segmentGraphemes(targetText)
    const targetLen = graphemesRef.current.length

    // The target was replaced by unrelated content (edit/branch), not appended to — restart.
    if (prevTarget !== '' && !targetText.startsWith(prevTarget)) {
      shownLenRef.current = 0
    } else if (shownLenRef.current > targetLen) {
      // Target shrank; only an append keeps the reveal position meaningful.
      shownLenRef.current = 0
    }

    // Everything is already visible (history content, or a finished reveal): show it as-is.
    if (shownLenRef.current >= targetLen) {
      if (frameRef.current !== null) {
        cancelFrame(frameRef.current)
        frameRef.current = null
      }
      setDisplayedText(targetText)
      return undefined
    }

    // Unseen content remains. Keep revealing it — even once `active` flips false (the run
    // finished right after emitting the final answer), so a one-shot final answer still streams
    // instead of jumping straight to the full text.
    if (frameRef.current !== null) {
      return undefined
    }

    const flush = (): void => {
      frameRef.current = null
      const graphemes = graphemesRef.current
      const targetLen = graphemes.length
      if (targetLen > SMOOTH_STREAM_MAX_CHARS) {
        shownLenRef.current = targetLen
        setDisplayedText(targetRef.current)
        return
      }
      const shown = getNextShownLength(shownLenRef.current, targetLen)
      shownLenRef.current = shown
      setDisplayedText(graphemes.slice(0, shown).join(''))
      if (shown < targetLen) {
        frameRef.current = scheduleFrame(flush)
      }
    }

    frameRef.current = scheduleFrame(flush)
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
