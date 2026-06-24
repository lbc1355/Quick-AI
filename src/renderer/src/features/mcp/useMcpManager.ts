import { useCallback, useEffect, useState } from 'react'
import type { McpServerStatus } from '../../../../shared/types'

type McpConfigFile = {
  servers?: Record<string, unknown>
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

export interface McpSaveMessage {
  text: string
  type: 'success' | 'error'
}

export const MCP_ADD_TEMPLATE = `{
  "servers": {
    "your-mcp-name": {
      "command": "",
      "args": []
    }
  }
}`

function parseMcpConfig(text: string): McpConfigFile {
  return JSON.parse(text) as McpConfigFile
}

export function useMcpManager(): {
  configDraftText: string
  serverStatuses: McpServerStatus[]
  jsonError: string | null
  isSaving: boolean
  saveMessage: McpSaveMessage | null
  expandedServers: Record<string, boolean>
  isConfigEditorOpen: boolean
  setIsConfigEditorOpen: (open: boolean) => void
  handleConfigChange: (text: string) => void
  handleSave: () => Promise<void>
  handleDeleteServer: (name: string) => Promise<void>
  toggleServerExpanded: (name: string) => void
  handleAddMcpCard: () => void
} {
  const [configDraftText, setConfigDraftText] = useState<string>(MCP_ADD_TEMPLATE)
  const [serverStatuses, setServerStatuses] = useState<McpServerStatus[]>([])
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [saveMessage, setSaveMessage] = useState<McpSaveMessage | null>(null)
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({})
  const [isConfigEditorOpen, setIsConfigEditorOpen] = useState(false)

  const loadData = useCallback(async (): Promise<void> => {
    try {
      const statuses = await window.api.mcpGetStatus()
      setServerStatuses(statuses)
    } catch (err) {
      console.error('Failed to load MCP data:', err)
    }
  }, [])

  const pollStatus = useCallback(async (): Promise<void> => {
    try {
      const statuses = await window.api.mcpGetStatus()
      setServerStatuses(statuses)
    } catch (err) {
      console.error('Failed to poll MCP status:', err)
    }
  }, [])

  const refreshAfterReload = useCallback((): void => {
    window.setTimeout(async () => {
      const statuses = await window.api.mcpGetStatus()
      setServerStatuses(statuses)
      setIsSaving(false)
    }, 1500)
  }, [])

  const handleConfigChange = useCallback((text: string): void => {
    setConfigDraftText(text)

    try {
      if (text.trim() === '') {
        setJsonError('Config cannot be empty')
        return
      }
      parseMcpConfig(text)
      setJsonError(null)
    } catch (err) {
      setJsonError((err as Error).message)
    }
  }, [])

  const handleSave = useCallback(async (): Promise<void> => {
    if (jsonError) {
      setSaveMessage({ text: '请先修正 JSON 格式错误', type: 'error' })
      return
    }

    setIsSaving(true)
    setSaveMessage(null)

    try {
      parseMcpConfig(configDraftText)

      await window.api.mcpSetConfig(configDraftText)
      setConfigDraftText(MCP_ADD_TEMPLATE)
      setSaveMessage({ text: '配置已保存并合并，服务重载中...', type: 'success' })
      refreshAfterReload()
    } catch (err) {
      setIsSaving(false)
      setSaveMessage({ text: `保存失败: ${(err as Error).message}`, type: 'error' })
    }
  }, [configDraftText, jsonError, refreshAfterReload])

  const handleDeleteServer = useCallback(
    async (name: string): Promise<void> => {
      if (!window.confirm(`确定要删除 MCP 服务 "${name}" 吗？`)) {
        return
      }

      setSaveMessage(null)
      setIsSaving(true)

      try {
        const result = await window.api.mcpDeleteServer(name)
        setJsonError(null)

        if (!result.deleted) {
          setIsSaving(false)
          setSaveMessage({ text: '未在配置文件中找到该服务。', type: 'error' })
          return
        }

        setServerStatuses((prev) => prev.filter((server) => server.name !== name))
        setSaveMessage({ text: `服务 "${name}" 已删除，重连中...`, type: 'success' })
        refreshAfterReload()
      } catch (err) {
        setIsSaving(false)
        setSaveMessage({ text: `删除失败: ${(err as Error).message}`, type: 'error' })
      }
    },
    [refreshAfterReload]
  )

  const toggleServerExpanded = useCallback((name: string): void => {
    setExpandedServers((prev) => ({
      ...prev,
      [name]: !prev[name]
    }))
  }, [])

  const handleAddMcpCard = useCallback((): void => {
    setConfigDraftText(MCP_ADD_TEMPLATE)
    setJsonError(null)
    setSaveMessage(null)
    setIsConfigEditorOpen(true)
  }, [])

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void loadData()
    }, 0)

    const timer = window.setInterval(() => {
      void pollStatus()
    }, 5000)

    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [loadData, pollStatus])

  return {
    configDraftText,
    serverStatuses,
    jsonError,
    isSaving,
    saveMessage,
    expandedServers,
    isConfigEditorOpen,
    setIsConfigEditorOpen,
    handleConfigChange,
    handleSave,
    handleDeleteServer,
    toggleServerExpanded,
    handleAddMcpCard
  }
}
