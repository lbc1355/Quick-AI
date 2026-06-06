import React, { useState, useEffect } from 'react'
import { Message } from '../../../shared/types'
import { Edit, RefreshCw, Paperclip, Sparkles } from 'lucide-react'
import { parseThinkTags, renderMessageContent, parseAgentLogs, AgentLogStep } from '../utils/messageFormat'

interface LogStepRowProps {
  log: AgentLogStep
  resultLog?: AgentLogStep
  errorLog?: AgentLogStep
}

const LogStepRow: React.FC<LogStepRowProps> = ({ log, resultLog, errorLog }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  
  const displayUrl = log.url ? log.url.replace(/^https?:\/\/(www\.)?/, '') : ''
  const truncatedUrl = displayUrl.length > 55 ? displayUrl.substring(0, 55) + '...' : displayUrl

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          cursor: 'pointer', 
          userSelect: 'none',
          color: 'var(--color-text-muted)',
          gap: '6px'
        }}
      >
        <span style={{ color: 'var(--color-text-muted)', opacity: 0.9 }}>
          Called {log.toolName} {truncatedUrl && `(${truncatedUrl})`}
        </span>
        <span style={{ fontSize: '8px', opacity: 0.6 }}>{isExpanded ? 'v' : '>'}</span>
        {resultLog ? (
          <span style={{ color: '#10b981', opacity: 0.8, fontSize: '9px', marginLeft: '4px' }}>[completed]</span>
        ) : errorLog ? (
          <span style={{ color: '#ef4444', opacity: 0.8, fontSize: '9px', marginLeft: '4px' }}>[failed]</span>
        ) : (
          <span style={{ color: '#eab308', opacity: 0.8, fontSize: '9px', marginLeft: '4px' }}>[running]</span>
        )}
      </div>
      
      {isExpanded && (
        <div style={{ 
          paddingLeft: '14px', 
          fontSize: '9px', 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '2px',
          color: 'var(--color-text-muted)',
          opacity: 0.8
        }}>
          {log.url && (
            <div style={{ wordBreak: 'break-all' }}>
              URL: <a href={log.url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{log.url}</a>
            </div>
          )}
          {resultLog && (
            <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              Title: {resultLog.title || 'No Title'}
            </div>
          )}
          {errorLog && (
            <div style={{ color: '#f87171' }}>
              Error: {errorLog.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const LogThinkRow: React.FC<{ log: AgentLogStep }> = ({ log }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          cursor: 'pointer', 
          userSelect: 'none',
          color: 'var(--color-text-muted)',
          gap: '6px'
        }}
      >
        <span style={{ color: 'var(--color-text-muted)', opacity: 0.9 }}>
          Thought (Step {log.step}/{log.maxSteps})
        </span>
        <span style={{ fontSize: '8px', opacity: 0.6 }}>{isExpanded ? 'v' : '>'}</span>
      </div>
      {isExpanded && (
        <div style={{ 
          paddingLeft: '14px', 
          fontSize: '9.5px',
          fontStyle: 'italic',
          color: 'var(--color-text-muted)',
          whiteSpace: 'pre-wrap',
          lineHeight: '1.4',
          opacity: 0.85
        }}>
          {log.thought}
        </div>
      )}
    </div>
  )
}

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
  const { logs, cleanContent } = parseAgentLogs(displayContent)
  const [isLogsExpanded, setIsLogsExpanded] = useState(isGenerating && !cleanContent)
  const isEditing = editingMessageId === msg.id
  
  const [elapsed, setElapsed] = useState<number>(0)
  const isFinished = !isGenerating || !!cleanContent

  useEffect(() => {
    if (isGenerating && !cleanContent && logs.length > 0) {
      const startTime = parseInt(msg.id) || Date.now()
      const timer = setInterval(() => {
        setElapsed(Math.round((Date.now() - startTime) / 1000))
      }, 500)
      return () => clearInterval(timer)
    }
    return undefined
  }, [isGenerating, cleanContent, logs.length, msg.id])

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
          margin: '12px 0 16px 0',
          padding: '0 4px',
          fontSize: '11px',
          color: 'var(--color-text-muted)'
        }}>
          <div
            onClick={() => setIsLogsExpanded(!isLogsExpanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              userSelect: 'none',
              fontWeight: '500',
              color: 'var(--color-text-muted)',
              gap: '6px',
              marginBottom: '8px'
            }}
          >
            <span>
              {isGenerating && !cleanContent
                ? `Worked for ${elapsed}s`
                : `Called tools (${logs.filter(l => l.type === 'tool').length} steps)`
              }
            </span>
            <span style={{ fontSize: '9px', opacity: 0.7 }}>{isLogsExpanded ? 'v' : '>'}</span>
          </div>

          {isLogsExpanded && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              paddingLeft: '16px'
            }}>
              {logs.reduce<React.ReactNode[]>((acc, log, logIdx) => {
                if (log.type === 'think') {
                  acc.push(
                    <LogThinkRow
                      key={`think-${log.step}-${logIdx}`}
                      log={log}
                    />
                  )
                } else if (log.type === 'tool') {
                  const resultLog = logs.find(l => l.step === log.step && l.type === 'result' && l.url === log.url)
                  const errorLog = logs.find(l => l.step === log.step && l.type === 'error')
                  
                  acc.push(
                    <LogStepRow
                      key={`step-${log.step}-${logIdx}`}
                      log={log}
                      resultLog={resultLog}
                      errorLog={errorLog}
                    />
                  )
                }
                return acc
              }, [])}
            </div>
          )}

          {/* Bottom Divider Line */}
          <div style={{ display: 'flex', alignItems: 'center', color: 'var(--color-text-muted)', fontSize: '10px', marginTop: '12px', opacity: 0.5 }}>
            <div style={{ flex: 1, borderBottom: '1px solid var(--color-border)' }}></div>
            <span style={{ padding: '0 10px', whiteSpace: 'nowrap' }}>
              {isFinished ? 'Tool execution finished' : 'Tool execution in progress'}
            </span>
            <div style={{ flex: 1, borderBottom: '1px solid var(--color-border)' }}></div>
          </div>
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
