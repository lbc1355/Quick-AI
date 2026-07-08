import React, { useEffect, useState, useCallback } from 'react'
import { Save, Brain, RefreshCw, FileText } from 'lucide-react'

interface MemoryEntry {
  id: string
  label: string
  kind: string
}

interface MemoryManagerProps {
  // Kept for compatibility with the settings view caller; memory is now machine-global.
  sessionId?: string | null
}

export const MemoryManager: React.FC<MemoryManagerProps> = () => {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [selectedId, setSelectedId] = useState<string>('always')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [statusText, setStatusText] = useState('')
  const [errorText, setErrorText] = useState('')

  const showStatus = (text: string, isError = false): void => {
    if (isError) {
      setErrorText(text)
      setStatusText('')
    } else {
      setStatusText(text)
      setErrorText('')
    }
    setTimeout(() => {
      setStatusText('')
      setErrorText('')
    }, 4000)
  }

  const loadEntry = useCallback(async (id: string): Promise<void> => {
    try {
      const text = await window.api.readMemoryEntry(id)
      setContent(text)
      setSelectedId(id)
      setDirty(false)
    } catch (err) {
      console.error('Failed to read memory entry:', err)
      showStatus('读取记忆文件失败', true)
    }
  }, [])

  const loadEntries = useCallback(async (): Promise<void> => {
    try {
      // Note: `loading` starts true; we intentionally don't set it synchronously here so the
      // mount effect performs no synchronous setState (react-hooks/set-state-in-effect).
      const list = await window.api.listMemoryEntries()
      setEntries(list)
      const stillExists = list.some((e) => e.id === selectedId)
      await loadEntry(stillExists ? selectedId : list[0]?.id || 'always')
    } catch (err) {
      console.error('Failed to load memory entries:', err)
      setErrorText('加载记忆库失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadEntry])

  useEffect(() => {
    // Mount-time async load; state is set only after the IPC await resolves.
    loadEntries().catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSelect = async (id: string): Promise<void> => {
    if (id === selectedId) return
    if (dirty && !window.confirm('当前文件有未保存的修改，切换将丢弃。确认切换？')) return
    await loadEntry(id)
  }

  const handleSave = async (): Promise<void> => {
    try {
      await window.api.writeMemoryEntry(selectedId, content)
      setDirty(false)
      showStatus('已保存并提交到 git')
      // Editing MEMORY.md regenerates the index; refresh the list so it stays in sync.
      await loadEntries()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showStatus(`保存失败: ${msg}`, true)
    }
  }

  const selected = entries.find((e) => e.id === selectedId)

  return (
    <section className="skill-manager memory-manager">
      <div className="memory-manager-toolbar">
        <span className="memory-manager-title">
          <Brain size={15} />
          记忆库（~/.quickai/memories）
        </span>
        <div className="memory-manager-actions">
          <button
            className="settings-secondary-btn memory-manager-action"
            onClick={() => loadEntries()}
            title="刷新"
          >
            <RefreshCw size={12} />
            <span>刷新</span>
          </button>
          <button
            className="settings-save-btn memory-manager-action"
            onClick={handleSave}
            disabled={!dirty}
          >
            <Save size={12} />
            保存
          </button>
        </div>
      </div>

      {loading ? (
        <div className="skill-empty">正在加载记忆库...</div>
      ) : (
        <div className="memory-manager-grid">
          <aside className="memory-entry-list" aria-label="记忆文件">
            {entries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => handleSelect(entry.id)}
                className={`memory-entry-button${entry.id === selectedId ? ' active' : ''}`}
                aria-pressed={entry.id === selectedId}
                title={entry.label}
              >
                <FileText size={13} />
                <span>{entry.label}</span>
              </button>
            ))}
          </aside>

          <div className="memory-editor">
            <div className="memory-editor-header">
              <span className="memory-editor-title">
                {selected?.label || selectedId}
                {dirty ? ' •' : ''}
              </span>
            </div>
            <textarea
              className="settings-input settings-textarea memory-editor-textarea"
              value={content}
              onChange={(e) => {
                setContent(e.target.value)
                setDirty(true)
              }}
              placeholder="（空）"
            />
          </div>
        </div>
      )}

      {(statusText || errorText) && (
        <div className={errorText ? 'skill-status error' : 'skill-status'}>
          {errorText || statusText}
        </div>
      )}
    </section>
  )
}
