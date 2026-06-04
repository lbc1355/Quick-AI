import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

export interface ApiProvider {
  id: string
  name: string
  apiKey: string
  apiUrl: string
  model: string
  modelsList: string[]
}

export interface StorageSchema {
  sessions: any[]
  settings: {
    providers: ApiProvider[]
    activeProviderId: string
    systemPrompt: string
    autoHideOnBlur: boolean
    theme?: 'dark' | 'light'
    // Legacy support for flat settings migration
    apiKey?: string
    apiUrl?: string
    model?: string
    modelsList?: string[]
  }
  skills: any[]
  memories: any[]
}

const DEFAULT_STORAGE: StorageSchema = {
  sessions: [],
  settings: {
    providers: [
      {
        id: 'provider-deepseek',
        name: 'DeepSeek',
        apiKey: '',
        apiUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        modelsList: ['deepseek-chat', 'deepseek-reasoner']
      },
      {
        id: 'provider-kimi',
        name: 'Kimi (Moonshot)',
        apiKey: '',
        apiUrl: 'https://api.moonshot.cn/v1',
        model: 'moonshot-v1-8k',
        modelsList: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
      },
      {
        id: 'provider-ollama',
        name: 'Local Ollama',
        apiKey: '',
        apiUrl: 'http://localhost:11434/v1',
        model: 'deepseek-r1:8b',
        modelsList: ['deepseek-r1:8b', 'llama3']
      }
    ],
    activeProviderId: 'provider-deepseek',
    systemPrompt: 'You are QuickAI, a helpful, fast, and polite AI desktop assistant. Respond concisely and accurately.',
    autoHideOnBlur: true
  },
  skills: [],
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
        
        // Filter out the built-in default skills triggers to completely delete them
        const defaultTriggers = [
          'explain',
          'review',
          'refactor',
          'optimize',
          'translate',
          'english',
          'regex',
          'mock',
          'summary'
        ]
        let loadedSkills = Array.isArray(parsed.skills) ? parsed.skills : []
        loadedSkills = loadedSkills.filter((s: any) => s && s.trigger && !defaultTriggers.includes(s.trigger))

        // Migrate settings from flat format to multi-provider structure if needed
        let settings = parsed.settings || {}
        if (!settings.providers || settings.providers.length === 0) {
          const oldApiKey = settings.apiKey || ''
          const oldApiUrl = settings.apiUrl || 'https://api.deepseek.com/v1'
          const oldModel = settings.model || 'deepseek-chat'
          const oldModelsList = settings.modelsList || ['deepseek-chat', 'deepseek-reasoner']

          // Create default provider from existing configuration
          const defaultProvider: ApiProvider = {
            id: 'provider-deepseek',
            name: oldApiUrl.includes('deepseek.com') ? 'DeepSeek' : '默认服务商',
            apiKey: oldApiKey,
            apiUrl: oldApiUrl,
            model: oldModel,
            modelsList: oldModelsList
          }

          // Prepopulate Kimi & Ollama
          const kimiProvider: ApiProvider = {
            id: 'provider-kimi',
            name: 'Kimi (Moonshot)',
            apiKey: '',
            apiUrl: 'https://api.moonshot.cn/v1',
            model: 'moonshot-v1-8k',
            modelsList: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
          }

          const ollamaProvider: ApiProvider = {
            id: 'provider-ollama',
            name: 'Local Ollama',
            apiKey: '',
            apiUrl: 'http://localhost:11434/v1',
            model: 'deepseek-r1:8b',
            modelsList: ['deepseek-r1:8b', 'llama3']
          }

          settings.providers = [defaultProvider, kimiProvider, ollamaProvider]
          settings.activeProviderId = 'provider-deepseek'
        }

        // Merge defaults to prevent breaking changes on old versions
        return {
          ...DEFAULT_STORAGE,
          ...parsed,
          skills: loadedSkills,
          settings: { ...DEFAULT_STORAGE.settings, ...settings }
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
