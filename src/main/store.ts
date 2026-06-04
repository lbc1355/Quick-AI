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
      name: '代码解释',
      trigger: 'explain',
      prompt: '请详细解释以下代码的作用、核心逻辑、优缺点，并给出优化建议：\n'
    },
    {
      id: 'translate',
      name: '中英翻译',
      trigger: 'translate',
      prompt: '请将以下文本翻译为中文（如果是英文）或英文（如果是中文）。直接给出翻译结果，不要做任何解释：\n'
    },
    {
      id: 'summary',
      name: '文本总结',
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
        // Merge defaults to prevent breaking changes on old versions
        return {
          ...DEFAULT_STORAGE,
          ...parsed,
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
