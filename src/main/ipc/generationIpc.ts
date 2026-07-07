import { ipcMain, BrowserWindow } from 'electron'
import type { FileStore } from '../store'
import { handleChatCompletion, fetchModels, abortChatCompletion } from '../aiClient'
import {
  runAgentSkill,
  runGeneralAgent,
  resolveToolPermission,
  resolveUserChoice,
  abortAgentSkill
} from '../agent'
import { getToolRegistryView } from '../toolRegistry'

export function registerGenerationIpc(store: FileStore): void {
  ipcMain.handle('list-agent-tools', () => {
    return getToolRegistryView()
      .list()
      .filter((tool) => tool.implemented && tool.discoverable)
      .map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        category: tool.category,
        risk: tool.risk,
        source: tool.source || 'builtin',
        parameters: tool.parameters
      }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  })

  ipcMain.handle('fetch-models', (_event, fetchUrl, apiKey) => {
    return fetchModels(fetchUrl, apiKey)
  })

  ipcMain.on('start-chat-completion', (event, reqId, options) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const permissions = store.get('settings').permissions
      if (options.runMode === 'agent') {
        const systemPrompt = store.get('settings').systemPrompt
        runGeneralAgent(win, reqId, { ...options, systemPrompt }, permissions)
      } else {
        handleChatCompletion(win, reqId, options)
      }
    }
  })

  ipcMain.on('start-agent-skill', (event, reqId, options) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const permissions = store.get('settings').permissions
      runAgentSkill(win, reqId, options, permissions)
    }
  })

  ipcMain.on('respond-tool-permission', (_event, reqId, callId, approved) => {
    resolveToolPermission(reqId, callId, approved)
  })

  ipcMain.on('respond-user-choice', (_event, reqId, requestId, response) => {
    resolveUserChoice(String(reqId || ''), String(requestId || ''), response || {})
  })

  ipcMain.on('abort-generation', (_event, reqId) => {
    abortChatCompletion(reqId)
    abortAgentSkill(reqId)
  })
}
