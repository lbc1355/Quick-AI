export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning_content?: string
  files?: Array<{ name: string; content: string; type: string }>
}

export interface ChatCompletionMessage {
  role: string
  content: string | Array<{
    type: string
    text?: string
    image_url?: { url: string }
  }>
}

export interface Session {
  id: string
  title: string
  messages: Message[]
  lastActiveTime?: number
}

export interface ApiProvider {
  id: string
  name: string
  type: 'deepseek' | 'kimi' | 'ollama' | 'custom'
  apiKey: string
  apiUrl: string
  model: string
  modelsList: string[]
}

export interface AppSettings {
  providers: ApiProvider[]
  activeProviderId: string
  systemPrompt: string
  autoHideOnBlur: boolean
  theme?: 'dark' | 'light'
}

export type SkillMode = 'insert' | 'send'

export interface Skill {
  id: string
  name: string
  trigger: string
  prompt: string
  description?: string
  triggers?: string[]
  mode?: SkillMode
  source?: 'manual' | 'markdown'
  installedAt?: number
  updatedAt?: number
}

export interface Memory {
  id: string
  content: string
  createdAt: number
}

export interface StorageSchema {
  sessions: Session[]
  settings: AppSettings
  skills: Skill[]
  memories: Memory[]
}

export type StoreKey = keyof StorageSchema
export type StoreValue<K extends StoreKey> = StorageSchema[K]

export interface AutocompleteItem {
  id: string
  name: string
  trigger: string
  type: 'command' | 'skill' | 'model' | 'session' | 'delete-session' | 'provider'
  cmd?: string
  prompt?: string
  skillId?: string
  skillMode?: SkillMode
  modelId?: string
  sessionId?: string
  providerId?: string
}
