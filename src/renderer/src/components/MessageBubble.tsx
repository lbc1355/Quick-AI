import React, { useState } from 'react'
import { Message } from '../../../shared/types'
import { Edit, RefreshCw, Paperclip, Sparkles } from 'lucide-react'
import { parseThinkTags, renderMessageContent, parseAgentLogs } from '../utils/messageFormat'

interface MessageBubbleProps {
  msg: Message
  idx: number
  isGenerating: boolean
  editingMessageId: string | null
  editingText: string
  onStartEdit: (msg: Message) => void
  onCancelEdit: () => void
  onSaveEdit: (msgId: string, text: string) => void
  onRegenerate: (idx: number) => void
  onChangeEditingText: (text: string) => void
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  msg,
  idx,
  isGenerating,
  editingMessageId,
  editingText,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRegenerate,
  onChangeEditingText
}) => {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isLogsExpanded, setIsLogsExpanded] = useState(true)
  const { content: displayContent, reasoning: displayReasoning } = parseThinkTags(
    msg.content,
    msg.reasoning_content
  )
  const { logs, cleanContent, skillName } = parseAgentLogs(displayContent)
  const isEditing = editingMessageId === msg.id

  return (
    <div className={`message-bubble ${msg.role}`}>
      <div className={`avatar ${msg.role}`}>{msg.role === 'user' ? 'U' : 'AI'}</div>
      <div className="message-content-wrapper" style={{ maxWidth: '100%' }}>
        {isEditing ? (
          <div className="message-edit-container">
            <textarea
              className="message-edit-textarea"
              value={editingText}
              onChange={(e) => onChangeEditingText(e.target.value)}
            />
            <div className="message-edit-actions">
              <button className="edit-btn cancel" onClick={onCancelEdit}>
                取消
              </button>
              <button className="edit-btn save" onClick={() => onSaveEdit(msg.id, editingText)}>
                保存并重发
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="message-text">
              {msg.files && msg.files.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  {msg.files.map((f, fileIdx) => (
                    <div
                      key={fileIdx}
                      style={{
                        fontSize: '11px',
                        background: 'rgba(255, 255, 255, 0.08)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <Paperclip size={10} />
                      <span>{f.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Thinking/Reasoning block rendering (DeepSeek R1 style) */}
              {displayReasoning && (
                <div className="reasoning-block" style={{ marginBottom: '10px' }}>
                  <div
                    onClick={() => setIsExpanded(!isExpanded)}
                    style={{
                      fontSize: '12px',
                      color: '#60a5fa',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      userSelect: 'none',
                      marginBottom: '6px',
                      fontWeight: '600'
                    }}
                  >
                    <Sparkles
                      size={11}
                      style={{
                        animation:
                          isGenerating && !displayContent ? 'spin 3s linear infinite' : 'none'
                      }}
                    />
                    <span>
                      {isGenerating && !displayContent
                        ? '正在思考中..'
                        : isExpanded
                          ? '思考过程 (收起)'
                          : '思考过程 (展开)'}
                    </span>
                  </div>
                  {isExpanded && (
                    <div
                      style={{
                        fontSize: '12px',
                        color: 'var(--color-text-muted)',
                        borderLeft: '2px solid rgba(96, 165, 250, 0.35)',
                        paddingLeft: '10px',
                        marginLeft: '4px',
                        fontStyle: 'italic',
                        whiteSpace: 'pre-wrap',
                        lineHeight: '1.6',
                        background: 'var(--color-card-bg)',
                        padding: '6px 10px',
                        borderRadius: '0 6px 6px 0'
                      }}
                    >
                      {displayReasoning}
                    </div>
                  )}
                </div>
              )}

              {/* Agent execution logs block */}
              {logs.length > 0 && (
                <div className="agent-logs-block" style={{ marginBottom: '10px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.08)', overflow: 'hidden' }}>
                  <div
                    onClick={() => setIsLogsExpanded(!isLogsExpanded)}
                    style={{
                      fontSize: '12.5px',
                      color: 'var(--color-text-title)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      userSelect: 'none',
                      fontWeight: '600',
                      borderBottom: isLogsExpanded ? '1px solid rgba(255, 255, 255, 0.08)' : 'none'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px' }}>⚙️</span>
                      <span>Agent 执行日志 ({skillName || 'multi-search-engine'})</span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      {isLogsExpanded ? '收起' : `展开 (${logs.filter(l => l.type === 'tool').length} 个步骤)`}
                    </span>
                  </div>
                  {isLogsExpanded && (
                    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto', fontSize: '12px', fontFamily: 'Consolas, monospace', background: '#13131a' }}>
                      {logs.map((log, logIdx) => {
                        const uniqueKey = `log-${logIdx}`
                        if (log.type === 'tool') {
                          return (
                            <div key={uniqueKey} style={{ borderLeft: '2px solid #a855f7', paddingLeft: '8px', margin: '2px 0' }}>
                              <div style={{ color: '#c084fc', fontWeight: 'bold' }}>
                                [步骤 {log.step}/{log.maxSteps}] 调用 {log.toolName}
                              </div>
                              <div style={{ color: '#9ca3af', wordBreak: 'break-all', fontSize: '11px' }}>
                                {log.url}
                              </div>
                            </div>
                          )
                        } else if (log.type === 'result') {
                          return (
                            <div key={uniqueKey} style={{ borderLeft: '2px solid #10b981', paddingLeft: '8px', margin: '2px 0' }}>
                              <div style={{ color: '#34d399', fontWeight: 'bold' }}>
                                └─ 获得结果: {log.title}
                              </div>
                              <div style={{ color: '#6b7280', wordBreak: 'break-all', fontSize: '11px' }}>
                                {log.url}
                              </div>
                            </div>
                          )
                        } else {
                          return (
                            <div key={uniqueKey} style={{ borderLeft: '2px solid #ef4444', paddingLeft: '8px', margin: '2px 0' }}>
                              <div style={{ color: '#f87171', fontWeight: 'bold' }}>
                                └─ 发生错误: {log.error}
                              </div>
                            </div>
                          )
                        }
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Render main text content */}
              {cleanContent ? (
                renderMessageContent(cleanContent)
              ) : (
                /* Show small thinking pulsing dot if thinking and content is empty */
                isGenerating &&
                (displayReasoning ? (
                  <span style={{ opacity: 0.5, fontSize: '13px', fontStyle: 'italic' }}>
                    思考完毕，正在生成回答..
                  </span>
                ) : logs.length > 0 ? (
                  <span style={{ opacity: 0.6, fontSize: '12.5px', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                    <span className="status-dot loading" style={{ width: '6px', height: '6px' }} />
                    <span>Agent 正在抓取网页并分析中...</span>
                  </span>
                ) : null)
              )}
            </div>

            {!isGenerating && (
              <div
                className="message-actions"
                style={{ justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
              >
                {msg.role === 'user' ? (
                  <button className="msg-action-btn" onClick={() => onStartEdit(msg)}>
                    <Edit size={10} />
                    <span>编辑</span>
                  </button>
                ) : (
                  <button className="msg-action-btn" onClick={() => onRegenerate(idx)}>
                    <RefreshCw size={10} />
                    <span>重新生成</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
