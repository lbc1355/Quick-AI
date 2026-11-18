import type { Message } from '../../../../shared/types'
import { describe, expect, it } from 'vitest'
import { getVisibleChatMessages, isInternalChatMessage } from './messageVisibility'

describe('chat message visibility', () => {
  it('hides internal background result prompts without removing them from model history', () => {
    const internal: Message = {
      id: 'background-result-source-job-1',
      role: 'user',
      content: 'background result',
      isSynthetic: true,
      isInternal: true
    }
    const visible: Message = {
      id: 'background-result-assistant-job-1',
      role: 'assistant',
      content: 'Handled result'
    }
    const history = [internal, visible]

    expect(getVisibleChatMessages(history)).toEqual([visible])
    expect(history).toHaveLength(2)
  })

  it('hides older background result prompts saved without visibility flags', () => {
    expect(
      isInternalChatMessage({
        id: 'background-result-source-legacy-job',
        role: 'user',
        content: 'legacy result'
      })
    ).toBe(true)
  })

  it('does not hide unrelated synthetic messages', () => {
    expect(
      isInternalChatMessage({
        id: 'synthetic-visible-1',
        role: 'user',
        content: 'visible synthetic message',
        isSynthetic: true
      })
    ).toBe(false)
  })
})
