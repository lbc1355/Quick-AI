import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

import { StorageSchema, ApiProvider, Skill, AppSettings } from '../shared/types'

interface LegacyAppSettings {
  providers?: ApiProvider[]
  activeProviderId?: string
  systemPrompt?: string
  autoHideOnBlur?: boolean
  theme?: 'dark' | 'light'
  apiKey?: string
  apiUrl?: string
  model?: string
  modelsList?: string[]
  permissions?: {
    [toolName: string]: 'allow' | 'ask' | 'deny'
  }
}

const DEFAULT_STORAGE: StorageSchema = {
  sessions: [],
  settings: {
    providers: [
      {
        id: 'provider-deepseek',
        name: 'DeepSeek',
        type: 'deepseek',
        apiKey: '',
        apiUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        modelsList: ['deepseek-chat', 'deepseek-reasoner']
      },
      {
        id: 'provider-kimi',
        name: 'Kimi (Moonshot)',
        type: 'kimi',
        apiKey: '',
        apiUrl: 'https://api.moonshot.cn/v1',
        model: 'moonshot-v1-8k',
        modelsList: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
      },
      {
        id: 'provider-ollama',
        name: 'Local Ollama',
        type: 'ollama',
        apiKey: '',
        apiUrl: 'http://localhost:11434/v1',
        model: 'deepseek-r1:8b',
        modelsList: ['deepseek-r1:8b', 'llama3']
      }
    ],
    activeProviderId: 'provider-deepseek',
    systemPrompt:
      'You are QuickAI, a helpful, fast, and polite AI desktop assistant. Respond concisely and accurately.',
    autoHideOnBlur: true,
    permissions: {
      fetch_url: 'allow',
      web_search: 'allow',
      file_read: 'ask',
      file_write: 'deny',
      shell: 'deny'
    }
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
        let loadedSkills: Skill[] = Array.isArray(parsed.skills) ? parsed.skills : []
        loadedSkills = loadedSkills
          .filter((s: Skill) => s && s.trigger && s.prompt && !defaultTriggers.includes(s.trigger))
          .map((s: Skill) => ({
            ...s,
            triggers: s.triggers && s.triggers.length > 0 ? s.triggers : [s.trigger],
            kind: s.kind || (s.mode === 'run' ? 'agent' : 'prompt'),
            tools:
              s.kind === 'agent' || s.mode === 'run'
                ? Array.from(new Set([...(s.tools || []), 'fetch_url']))
                : s.tools || [],
            mode: s.mode || (s.kind === 'agent' ? 'run' : 'insert'),
            rawMarkdown: s.rawMarkdown || s.prompt
          }))

        // Migrate settings from flat format to multi-provider structure if needed
        const settings = (parsed.settings as LegacyAppSettings) || {}
        if (!settings.providers || settings.providers.length === 0) {
          const oldApiKey = settings.apiKey || ''
          const oldApiUrl = settings.apiUrl || 'https://api.deepseek.com/v1'
          const oldModel = settings.model || 'deepseek-chat'
          const oldModelsList = settings.modelsList || ['deepseek-chat', 'deepseek-reasoner']

          // Create default provider from existing configuration
          const defaultProvider: ApiProvider = {
            id: 'provider-deepseek',
            name: oldApiUrl.includes('deepseek.com') ? 'DeepSeek' : '默认服务商',
            type: oldApiUrl.includes('deepseek.com') ? 'deepseek' : 'custom',
            apiKey: oldApiKey,
            apiUrl: oldApiUrl,
            model: oldModel,
            modelsList: oldModelsList
          }

          // Prepopulate Kimi & Ollama
          const kimiProvider: ApiProvider = {
            id: 'provider-kimi',
            name: 'Kimi (Moonshot)',
            type: 'kimi',
            apiKey: '',
            apiUrl: 'https://api.moonshot.cn/v1',
            model: 'moonshot-v1-8k',
            modelsList: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
          }

          const ollamaProvider: ApiProvider = {
            id: 'provider-ollama',
            name: 'Local Ollama',
            type: 'ollama',
            apiKey: '',
            apiUrl: 'http://localhost:11434/v1',
            model: 'deepseek-r1:8b',
            modelsList: ['deepseek-r1:8b', 'llama3']
          }

          settings.providers = [defaultProvider, kimiProvider, ollamaProvider]
          settings.activeProviderId = 'provider-deepseek'
        }

        // Ensure all loaded providers have a "type" attribute for backward compatibility
        if (settings.providers && settings.providers.length > 0) {
          settings.providers = settings.providers.map((p: ApiProvider) => {
            if (!p.type) {
              let detectedType: 'deepseek' | 'kimi' | 'ollama' | 'custom' = 'custom'
              if (p.apiUrl.includes('deepseek.com')) detectedType = 'deepseek'
              else if (p.apiUrl.includes('moonshot.cn')) detectedType = 'kimi'
              else if (p.apiUrl.includes('localhost') || p.apiUrl.includes('127.0.0.1'))
                detectedType = 'ollama'
              return { ...p, type: detectedType }
            }
            return p
          })
        }

        // Merge defaults to prevent breaking changes on old versions
        const mergedSettings: AppSettings = {
          ...DEFAULT_STORAGE.settings,
          ...settings,
          permissions: {
            ...DEFAULT_STORAGE.settings.permissions,
            ...(settings.permissions || {})
          }
        }

        return {
          ...DEFAULT_STORAGE,
          ...parsed,
          skills: loadedSkills,
          settings: mergedSettings
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
