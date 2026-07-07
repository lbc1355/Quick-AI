import { ipcMain } from 'electron'
import { McpManager } from '../mcpManager'
import { logger } from '../logger'

export function registerMcpIpc(): void {
  ipcMain.handle('mcp-get-config', () => {
    return McpManager.readConfigRaw()
  })

  ipcMain.handle('mcp-set-config', (_event, content) => {
    const merged = McpManager.writeConfigRaw(content)
    McpManager.reload().catch((err) => {
      logger.error('MCP', `Error reloading after config write: ${err.message}`)
    })
    return merged
  })

  ipcMain.handle('mcp-delete-server', (_event, name) => {
    if (typeof name !== 'string') {
      throw new Error('MCP server name must be a string')
    }

    const result = McpManager.deleteServer(name)
    McpManager.reload().catch((err) => {
      logger.error('MCP', `Error reloading after MCP server delete: ${err.message}`)
    })
    return result
  })

  ipcMain.handle('mcp-get-status', () => {
    return McpManager.getStatuses()
  })

  ipcMain.handle('mcp-open-config', () => {
    McpManager.openConfigFolder()
  })
}
