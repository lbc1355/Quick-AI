import { describe, expect, it } from 'vitest'
import { createSkillResult, pathToFileUrl } from './skillResult'

describe('skill result helpers', () => {
  it('creates consistent model and UI payloads for skill tools', () => {
    const result = createSkillResult({
      resultForModel: 'Loaded skill body',
      title: 'Load Skill: Example',
      summary: 'Loaded skill-example',
      filePath: 'C:\\tmp\\skill-example\\SKILL.md'
    })

    expect(result.resultForModel).toBe('Loaded skill body')
    expect(result.resultForUi.title).toBe('Load Skill: Example')
    expect(result.resultForUi.summary).toBe('Loaded skill-example')
    expect(result.resultForUi.details).toBe('Loaded skill body')
    expect(result.resultForUi.url).toBe('file:///C:/tmp/skill-example/SKILL.md')
  })

  it('normalizes Windows paths to percent-encoded file URLs', () => {
    expect(pathToFileUrl('D:\\Git\\Quick Ai\\skill')).toBe('file:///D:/Git/Quick%20Ai/skill')
  })
})
