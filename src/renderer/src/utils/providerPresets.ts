import { ApiProvider } from '../../../shared/types'

export interface ProviderPreset {
  type: ApiProvider['type']
  name: string
  apiUrl: string
  modelsList: string[]
  defaultModel: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    type: 'deepseek',
    name: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com/v1',
    modelsList: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat'
  },
  {
    type: 'kimi',
    name: 'Kimi (Moonshot)',
    apiUrl: 'https://api.moonshot.cn/v1',
    modelsList: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    defaultModel: 'moonshot-v1-8k'
  },
  {
    type: 'ollama',
    name: 'Local Ollama',
    apiUrl: 'http://localhost:11434/v1',
    modelsList: ['deepseek-r1:8b', 'llama3'],
    defaultModel: 'deepseek-r1:8b'
  },
  {
    type: 'glm',
    name: '智谱 GLM',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelsList: ['glm-4-flash', 'glm-4-plus', 'glm-4-long'],
    defaultModel: 'glm-4-flash'
  },
  {
    type: 'custom',
    name: '自定义服务商',
    apiUrl: '',
    modelsList: ['custom-model'],
    defaultModel: 'custom-model'
  }
]
