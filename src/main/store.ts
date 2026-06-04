import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

export interface StorageSchema {
  sessions: any[]
  settings: {
    apiKey: string
    apiUrl: string
    model: string
    modelsList: string[]
    systemPrompt: string
    autoHideOnBlur: boolean
  }
  skills: any[]
  memories: any[]
}

const DEFAULT_STORAGE: StorageSchema = {
  sessions: [],
  settings: {
    apiKey: '',
    apiUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    modelsList: ['deepseek-chat', 'deepseek-reasoner'],
    systemPrompt: 'You are QuickAI, a helpful, fast, and polite AI desktop assistant. Respond concisely and accurately.',
    autoHideOnBlur: true
  },
  skills: [
    {
      id: 'explain',
      name: '💡 代码解释 (Explain Code)',
      trigger: 'explain',
      prompt: '请详细解释以下代码的作用、核心逻辑、优缺点，并给出优化建议：\n'
    },
    {
      id: 'review',
      name: '🔍 代码审查 (Code Review)',
      trigger: 'review',
      prompt: '请对以下代码进行审查，指出潜在的 Bug、内存泄露、代码坏味道、并发安全问题，并给出符合最佳实践的重构版本：\n'
    },
    {
      id: 'refactor',
      name: '🛠️ 代码重构 (Refactor Code)',
      trigger: 'refactor',
      prompt: '请重构以下代码，提高其可读性、可维护性和扩展性，遵循 SOLID 原则，并保持原有逻辑不变：\n'
    },
    {
      id: 'optimize',
      name: '⚡ 性能优化 (Optimize Code)',
      trigger: 'optimize',
      prompt: '请分析并优化以下代码的性能，减少时间复杂度和空间复杂度，并给出优化前后的对比说明：\n'
    },
    {
      id: 'translate',
      name: '🌐 中英翻译 (Translate Text)',
      trigger: 'translate',
      prompt: '请将以下文本翻译为中文（如果是英文）或英文（如果是中文）。直接给出翻译结果，不要做任何解释：\n'
    },
    {
      id: 'english',
      name: '📝 英语润色 (Polish English)',
      trigger: 'english',
      prompt: '请对以下英文文本进行语法纠错、用词润色和口语化表达优化，使之更加地道自然，并给出修改前后的对比：\n'
    },
    {
      id: 'regex',
      name: '🧩 正则生成 (Generate Regex)',
      trigger: 'regex',
      prompt: '请帮我编写一个正则表达式，匹配以下要求：\n要求：\n同时给出正则表达式、详细的匹配逻辑解释以及几个测试匹配用例。'
    },
    {
      id: 'mock',
      name: '📊 模拟数据 (Mock JSON)',
      trigger: 'mock',
      prompt: '请根据以下数据结构或描述，生成符合规范的 Mock JSON 测试数据：\n描述：'
    },
    {
      id: 'summary',
      name: '📖 文本总结 (Summarize Text)',
      trigger: 'summary',
      prompt: '请用简洁明了的语言（可以使用列表）总结以下文本的核心要点：\n'
    }
  ],
  memories: []
}

export class FileStore {
  private filePath: string
  private cache: StorageSchema

  constructor() {
    // Save under AppData/Roaming/quickai (on Windows) or equivalent
    const dataDir = app.getPath('userData')
    this.filePath = join(dataDir, 'quickai_store.json')
    this.cache = this.load()
  }

  private load(): StorageSchema {
    try {
      if (existsSync(this.filePath)) {
        const fileContent = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(fileContent)
        // Merge skills uniquely by trigger to ensure new default skills are loaded
        const mergedSkills = [...DEFAULT_STORAGE.skills]
        if (parsed.skills && Array.isArray(parsed.skills)) {
          parsed.skills.forEach((oldSkill: any) => {
            const hasDuplicate = mergedSkills.some((s) => s.trigger === oldSkill.trigger)
            if (!hasDuplicate) {
              mergedSkills.push(oldSkill)
            }
          })
        }

        // Merge defaults to prevent breaking changes on old versions
        return {
          ...DEFAULT_STORAGE,
          ...parsed,
          skills: mergedSkills,
          settings: { ...DEFAULT_STORAGE.settings, ...(parsed.settings || {}) }
        }
      }
    } catch (e) {
      console.error('Failed to load store, resetting to default:', e)
    }
    return JSON.parse(JSON.stringify(DEFAULT_STORAGE))
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8')
    } catch (e) {
      console.error('Failed to save store to file:', e)
    }
  }

  public get<K extends keyof StorageSchema>(key: K): StorageSchema[K] {
    return this.cache[key]
  }

  public set<K extends keyof StorageSchema>(key: K, val: StorageSchema[K]): void {
    this.cache[key] = val
    this.save()
  }

  public getStorePath(): string {
    return this.filePath
  }
}
