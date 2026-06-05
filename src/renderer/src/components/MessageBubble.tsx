import React, { useState, useEffect } from 'react'
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
  const { content: displayContent, reasoning: displayReasoning } = parseThinkTags(
    msg.content,
    msg.reasoning_content
  )
  const { logs, cleanContent, skillName } = parseAgentLogs(displayContent)
  const [isLogsExpanded, setIsLogsExpanded] = useState(isGenerating && !cleanContent)
  const isEditing = editingMessageId === msg.id

  // Auto-collapse logs when final answer starts streaming
  useEffect(() => {
    if (cleanContent) {
      setIsLogsExpanded(false)
    }
  }, [cleanContent])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      {logs.length > 0 && (
        <div className="agent-logs-container-fullwidth" style={{
          margin: '14px -16px',
          padding: '10px 16px',
          borderTop: '1px solid var(--color-border)',
          borderBottom: '1px solid var(--color-border)',
          fontSize: '10px',
          background: 'rgba(255, 255, 255, 0.015)'
        }}>
          <div
            onClick={() => setIsLogsExpanded(!isLogsExpanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
              color: 'var(--color-text-muted)',
              fontWeight: '500'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-text-title)' }}>
                Agent 工具调用 ({logs.filter(l => l.type === 'tool').length} 步 / {skillName || 'search'})
              </span>
              {isGenerating && !cleanContent && (
                <span className="status-dot loading" style={{ width: '5px', height: '5px', marginLeft: '4px' }} />
              )}
            </div>
            <span style={{ fontSize: '9px', color: '#60a5fa', userSelect: 'none' }}>
              {isLogsExpanded ? '隐藏执行细节' : '显示执行细节'}
            </span>
          </div>

          {isLogsExpanded && (
            <div style={{
              marginTop: '10px',
              padding: '6px 4px 4px 4px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '220px',
              overflowY: 'auto',
              fontSize: '9.5px',
              fontFamily: 'Consolas, Courier New, monospace',
              color: 'var(--color-text)'
            }}>
              {logs.reduce<React.ReactNode[]>((acc, log, logIdx) => {
                if (log.type === 'tool') {
                  const resultLog = logs.find(l => l.step === log.step && l.type === 'result' && l.url === log.url)
                  const errorLog = logs.find(l => l.step === log.step && l.type === 'error')
                  
                  acc.push(
                    <div key={`step-${log.step}-${logIdx}`} style={{ display: 'flex', flexDirection: 'column', gap: '3px', borderBottom: '1px dashed var(--color-border)', paddingBottom: '6px', marginBottom: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#c084fc', fontWeight: 'bold' }}>[步骤 {log.step}/{log.maxSteps}] 调用 {log.toolName}</span>
                        {resultLog ? (
                          <span style={{ color: '#10b981', fontWeight: '500' }}>[完成]</span>
                        ) : errorLog ? (
                          <span style={{ color: '#ef4444', fontWeight: '500' }}>[错误]</span>
                        ) : (
                          <span style={{ color: '#eab308', fontWeight: '500' }}>[执行中...]</span>
                        )}
                      </div>
                      <div style={{ color: 'var(--color-text-muted)', wordBreak: 'break-all', fontSize: '8.5px', paddingLeft: '8px' }}>
                        链接: <a href={log.url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{log.url}</a>
                      </div>
                      {resultLog && (
                        <div style={{ color: '#34d399', fontSize: '8.5px', paddingLeft: '8px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          标题: {resultLog.title || '无标题页面'}
                        </div>
                      )}
                      {errorLog && (
                        <div style={{ color: '#f87171', fontSize: '8.5px', paddingLeft: '8px' }}>
                          错误日志: {errorLog.error}
                        </div>
                      )}
                    </div>
                  )
                }
                return acc
              }, [])}
            </div>
          )}
        </div>
      )}

      {/* 2. Standard message bubble wrapper */}
      {(cleanContent || displayReasoning || msg.role === 'user' || (isGenerating && !displayReasoning && logs.length === 0)) && (
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
                              isGenerating && !cleanContent ? 'spin 3s linear infinite' : 'none'
                          }}
                        />
                        <span>
                          {isGenerating && !cleanContent
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

                  {/* Render main text content */}
                  {cleanContent ? (
                    renderMessageContent(cleanContent)
                  ) : (
                    /* Show small thinking pulsing dot if thinking and content is empty */
                    isGenerating &&
                    displayReasoning && (
                      <span style={{ opacity: 0.5, fontSize: '13px', fontStyle: 'italic' }}>
                        思考完毕，正在生成回答..
                      </span>
                    )
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
      )}
    </div>
  )
}
