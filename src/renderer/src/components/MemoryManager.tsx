import React, { useEffect, useState, useMemo } from 'react'
import { Trash2, Edit2, Plus, Search, X, Save, Brain } from 'lucide-react'

interface MemoryDoc {
  id: string
  kind: 'constant' | 'ondemand' | 'memory' | 'soul'
  scope: 'global' | 'session'
  sessionId?: string
  key: string
  title: string
  content: string
  version: number
  parentId?: string
  status: string
  reason?: string
  createdAt: number
  updatedAt: number
}

interface MemoryManagerProps {
  sessionId: string | null
}

export const MemoryManager: React.FC<MemoryManagerProps> = ({ sessionId }) => {
  const [memories, setMemories] = useState<MemoryDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState<'all' | 'global' | 'session'>('all')
  const [kindFilter, setKindFilter] = useState<'all' | 'constant' | 'ondemand'>('all')

  // Edit / Create Form state
  const [editingDoc, setEditingDoc] = useState<Partial<MemoryDoc> | null>(null)
  const [formKey, setFormKey] = useState('')
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formKind, setFormKind] = useState<'constant' | 'ondemand'>('ondemand')
  const [formScope, setFormScope] = useState<'global' | 'session'>('session')

  const [statusText, setStatusText] = useState('')
  const [errorText, setErrorText] = useState('')

  const loadMemories = async (): Promise<void> => {
    try {
      setLoading(true)
      // Query memories with includeSession: true and current sessionId if available
      const docs = await window.api.listMemoryDocs({
        sessionId: sessionId || undefined,
        includeSession: !!sessionId,
        limit: 100
      })
      setMemories(docs)
    } catch (err) {
      console.error('Failed to load memories:', err)
      setErrorText('加载记忆失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMemories().catch(console.error)
  }, [sessionId])

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

  const handleEdit = (doc: MemoryDoc): void => {
    setEditingDoc(doc)
    setFormKey(doc.key)
    setFormTitle(doc.title)
    setFormContent(doc.content)
    const normalizedKind = doc.kind === 'soul' || doc.kind === 'constant' ? 'constant' : 'ondemand'
    setFormKind(normalizedKind)
    setFormScope(doc.scope)
  }

  const handleCreateNew = (): void => {
    setEditingDoc({}) // Empty object denotes a new document
    setFormKey('')
    setFormTitle('')
    setFormContent('')
    setFormKind('ondemand')
    setFormScope(sessionId ? 'session' : 'global')
  }

  const handleCancelEdit = (): void => {
    setEditingDoc(null)
  }

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!formKey.trim()) {
      showStatus('分类唯一标识 (Key) 不能为空', true)
      return
    }
    if (!formTitle.trim()) {
      showStatus('标题不能为空', true)
      return
    }
    if (!formContent.trim()) {
      showStatus('内容不能为空', true)
      return
    }

    try {
      const isNew = !editingDoc?.id
      const payload = {
        kind: formKind,
        scope: formScope,
        sessionId: formScope === 'session' ? (sessionId || undefined) : undefined,
        key: formKey.trim(),
        title: formTitle.trim(),
        content: formContent.trim(),
        baseVersionId: isNew ? undefined : editingDoc.id,
        reason: isNew ? 'Created in UI' : 'Updated in UI'
      }

      await window.api.replaceMemoryDoc(payload)
      showStatus(isNew ? '创建记忆成功' : '保存记忆成功')
      setEditingDoc(null)
      await loadMemories()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showStatus(`保存失败: ${msg}`, true)
    }
  }

  const handleArchive = async (doc: MemoryDoc): Promise<void> => {
    if (!window.confirm(`确认删除记忆分类 "${doc.title}" (Key: ${doc.key}) 吗？`)) {
      return
    }

    try {
      const success = await window.api.archiveMemoryDoc({
        kind: doc.kind,
        scope: doc.scope,
        sessionId: doc.sessionId,
        key: doc.key
      })

      if (success) {
        showStatus('记忆已删除/归档')
        await loadMemories()
      } else {
        showStatus('删除失败，可能文档已被移除', true)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showStatus(`删除失败: ${msg}`, true)
    }
  }

  const filteredMemories = useMemo(() => {
    return memories.filter((doc) => {
      // 1. Search Query
      const q = searchQuery.toLowerCase().trim()
      if (q) {
        const matchesKey = doc.key.toLowerCase().includes(q)
        const matchesTitle = doc.title.toLowerCase().includes(q)
        const matchesContent = doc.content.toLowerCase().includes(q)
        if (!matchesKey && !matchesTitle && !matchesContent) {
          return false
        }
      }

      // 2. Scope Filter
      if (scopeFilter !== 'all' && doc.scope !== scopeFilter) {
        return false
      }

      // 3. Kind Filter
      const normalizedKind = doc.kind === 'soul' || doc.kind === 'constant' ? 'constant' : 'ondemand'
      if (kindFilter !== 'all' && normalizedKind !== kindFilter) {
        return false
      }

      return true
    })
  }, [memories, searchQuery, scopeFilter, kindFilter])

  return (
    <section className="skill-manager memory-manager" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      
      {/* Edit View Overlay / Form */}
      {editingDoc && (
        <div className="memory-editor-overlay" style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'var(--color-bg-main)',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          padding: '16px',
          overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontSize: '15px', color: 'var(--color-text-title)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Brain size={16} />
              {editingDoc.id ? '编辑记忆文档' : '新建记忆分类'}
            </span>
            <button onClick={handleCancelEdit} className="skill-remove-btn" style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
            <div style={{ display: 'flex', gap: '16px' }}>
              <label className="settings-field" style={{ flex: 1 }}>
                <span className="settings-label">分类唯一标识 (Key)</span>
                <input
                  type="text"
                  className="settings-input"
                  value={formKey}
                  onChange={(e) => setFormKey(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                  placeholder="如 react_native_quirks"
                  disabled={!!editingDoc.id}
                  required
                />
              </label>

              <label className="settings-field" style={{ flex: 1 }}>
                <span className="settings-label">标题</span>
                <input
                  type="text"
                  className="settings-input"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="如 React Native 开发避坑"
                  required
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: '16px' }}>
              <label className="settings-field" style={{ flex: 1 }}>
                <span className="settings-label">加载策略</span>
                <select
                  className="settings-select"
                  value={formKind}
                  onChange={(e) => setFormKind(e.target.value as 'constant' | 'ondemand')}
                >
                  <option value="ondemand">按需加载 (推荐 - 仅注入索引摘要，AI需要时读取)</option>
                  <option value="constant">常态加载 (仅用于语气/核心规范，全局注入)</option>
                </select>
              </label>

              <label className="settings-field" style={{ flex: 1 }}>
                <span className="settings-label">适用范围</span>
                <select
                  className="settings-select"
                  value={formScope}
                  onChange={(e) => setFormScope(e.target.value as 'global' | 'session')}
                  disabled={!sessionId}
                >
                  <option value="session">仅当前对话 (Session)</option>
                  <option value="global">跨所有对话生效 (Global)</option>
                </select>
              </label>
            </div>

            <label className="settings-field settings-field-wide" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span className="settings-label">记忆详细内容 (Markdown 格式)</span>
              <textarea
                className="settings-input settings-textarea"
                style={{ flex: 1, minHeight: '180px', fontFamily: 'monospace', fontSize: '13px' }}
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="# 记忆条目&#10;- 条目 1...&#10;- 条目 2..."
                required
              />
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
              <button type="button" className="settings-save-btn skill-install-btn" onClick={handleCancelEdit} style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)' }}>
                取消
              </button>
              <button type="submit" className="settings-save-btn" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Save size={12} />
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Header controls */}
      <div className="skill-manager-header" style={{ marginBottom: '12px', flexShrink: 0 }}>
        <span
          className="settings-label"
          style={{ fontSize: '13.5px', color: 'var(--color-text-title)', fontWeight: 'bold' }}
        >
          记忆卡片 ({filteredMemories.length})
        </span>
        <div className="skill-install-actions">
          <button
            className="settings-save-btn skill-install-btn"
            onClick={handleCreateNew}
            title="新建记忆分类"
          >
            <Plus size={12} />
            <span>新建分类</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '150px' }}>
          <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
          <input
            type="text"
            className="settings-input"
            style={{ paddingLeft: '28px', height: '28px', fontSize: '12.5px' }}
            placeholder="搜索 Key、标题、内容..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <select
          className="settings-select"
          style={{ width: '100px', height: '28px', padding: '0 4px', fontSize: '12.5px' }}
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as any)}
        >
          <option value="all">所有范围</option>
          <option value="global">Global (全局)</option>
          <option value="session">Session (单会话)</option>
        </select>

        <select
          className="settings-select"
          style={{ width: '100px', height: '28px', padding: '0 4px', fontSize: '12.5px' }}
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as any)}
        >
          <option value="all">所有策略</option>
          <option value="ondemand">按需加载</option>
          <option value="constant">常态加载</option>
        </select>
      </div>

      {/* Main List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div className="skill-empty">正在加载记忆...</div>
        ) : filteredMemories.length === 0 ? (
          <div className="skill-empty">没有匹配的记忆</div>
        ) : (
          <div className="skill-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredMemories.map((doc) => {
              const isConstant = doc.kind === 'soul' || doc.kind === 'constant'
              const preview = doc.content.replace(/\s+/g, ' ').slice(0, 100)
              return (
                <div key={doc.id} className="skill-card" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px' }}>
                  <div className="skill-card-main" style={{ flex: 1, minWidth: 0, marginRight: '16px' }}>
                    <div className="skill-card-title-row" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span className="skill-card-title" style={{ fontWeight: 'bold' }}>{doc.title}</span>
                      <code style={{ fontSize: '11px', backgroundColor: 'var(--color-bg-secondary)', padding: '2px 4px', borderRadius: '4px', color: 'var(--color-text-muted)' }}>
                        {doc.key}
                      </code>
                      <span className="skill-card-mode" style={{
                        fontSize: '10.5px',
                        padding: '1px 5px',
                        backgroundColor: isConstant ? 'rgba(235, 94, 85, 0.1)' : 'rgba(56, 189, 248, 0.1)',
                        color: isConstant ? 'var(--color-accent-red, #eb5e55)' : 'var(--color-text-accent, #38bdf8)',
                        borderRadius: '4px'
                      }}>
                        {isConstant ? '常态' : '按需'}
                      </span>
                      <span className="skill-card-mode" style={{
                        fontSize: '10.5px',
                        padding: '1px 5px',
                        backgroundColor: doc.scope === 'global' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(107, 114, 128, 0.1)',
                        color: doc.scope === 'global' ? '#10b981' : '#9ca3af',
                        borderRadius: '4px'
                      }}>
                        {doc.scope === 'global' ? '全局' : '会话'}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>v{doc.version}</span>
                    </div>

                    <div className="skill-description" style={{
                      marginTop: '6px',
                      fontSize: '12px',
                      color: 'var(--color-text-muted)',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap'
                    }}>
                      {preview}...
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                    <button
                      className="skill-remove-btn"
                      style={{ color: 'var(--color-text-primary)' }}
                      onClick={() => handleEdit(doc)}
                      title="编辑记忆"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      className="skill-remove-btn"
                      onClick={() => handleArchive(doc)}
                      title="删除/归档"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Status Notifications */}
      {(statusText || errorText) && (
        <div className={errorText ? 'skill-status error' : 'skill-status'} style={{ marginTop: '8px', flexShrink: 0 }}>
          {errorText || statusText}
        </div>
      )}
    </section>
  )
}
