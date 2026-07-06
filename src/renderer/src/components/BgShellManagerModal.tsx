import React, { useState, useEffect, useRef } from 'react'
import { X, Terminal, Power, RefreshCw, Layers } from 'lucide-react'

interface BgShellInfo {
  id: string
  command: string
  status: string
  pid?: number
  createdAt: number
  totalOutputChars: number
}

interface BgShellManagerModalProps {
  sessionId?: string
  onClose: () => void
}

export const BgShellManagerModal: React.FC<BgShellManagerModalProps> = ({ sessionId, onClose }) => {
  const [processes, setProcesses] = useState<BgShellInfo[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [logs, setLogs] = useState<string>('')
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const logTerminalRef = useRef<HTMLPreElement>(null)

  const fetchList = async (silent = false): Promise<void> => {
    if (!silent) setIsLoadingList(true)
    try {
      const list = await window.api.bgShellList(sessionId)
      setProcesses(list)
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0].id)
      }
    } catch (e) {
      console.error('Failed to fetch background processes', e)
    } finally {
      setIsLoadingList(false)
    }
  }

  const fetchLogs = async (id: string, silent = false): Promise<void> => {
    if (!silent) setIsLoadingLogs(true)
    try {
      const res = await window.api.bgShellReadLog(id)
      setLogs(res.output || '(无日志输出)')
      // Auto scroll terminal to bottom on first load or new logs
      setTimeout(() => {
        if (logTerminalRef.current) {
          logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight
        }
      }, 50)
    } catch (e) {
      console.error('Failed to read logs for', id, e)
      setLogs(`读取日志失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setIsLoadingLogs(false)
    }
  }

  const handleStop = async (id: string): Promise<void> => {
    if (!window.confirm('确定要终止该后台进程及其所有子进程吗？')) return
    try {
      await window.api.bgShellStop(id)
      await fetchList(true)
      await fetchLogs(id, true)
    } catch (e) {
      alert(`停止进程失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Poll list and active logs
  useEffect(() => {
    fetchList()
    const timer = setInterval(() => {
      fetchList(true)
    }, 3000)
    return () => clearInterval(timer)
  }, [sessionId])

  useEffect(() => {
    if (!selectedId) {
      setLogs('')
      return undefined
    }
    fetchLogs(selectedId)
    const timer = setInterval(() => {
      fetchLogs(selectedId, true)
    }, 2000)
    return () => clearInterval(timer)
  }, [selectedId])

  const selectedProcess = processes.find((p) => p.id === selectedId)

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn 0.2s ease-out'
      }}
    >
      <div
        style={{
          width: '90%',
          maxWidth: '960px',
          height: '80%',
          maxHeight: '680px',
          backgroundColor: 'var(--color-bg-main)',
          border: '1px solid var(--color-border)',
          borderRadius: '12px',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.3)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-bg-header)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={18} style={{ color: 'var(--color-primary)' }} />
            <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>后台进程管理</h2>
            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: '8px' }}>
              ({processes.length} 个进程)
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              onClick={() => fetchList()}
              disabled={isLoadingList}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px',
                borderRadius: '4px',
                transition: 'all 0.15s ease'
              }}
              title="刷新列表"
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
            >
              <RefreshCw size={15} className={isLoadingList ? 'spin' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px',
                borderRadius: '4px',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ flex: '1 1 auto', display: 'flex', overflow: 'hidden' }}>
          {/* Left panel: List */}
          <div
            style={{
              width: '320px',
              borderRight: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'var(--color-bg-sidebar, var(--color-card-bg))',
              overflowY: 'auto'
            }}
          >
            {processes.length === 0 ? (
              <div
                style={{
                  padding: '40px 20px',
                  textAlign: 'center',
                  color: 'var(--color-text-muted)',
                  fontSize: '13px'
                }}
              >
                当前没有任何运行中的后台进程。
              </div>
            ) : (
              processes.map((proc) => {
                const isSelected = proc.id === selectedId
                const isRunning = proc.status === 'running'
                const isError = proc.status === 'error'
                return (
                  <div
                    key={proc.id}
                    onClick={() => setSelectedId(proc.id)}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--color-border)',
                      cursor: 'pointer',
                      backgroundColor: isSelected
                        ? 'var(--color-card-bg-hover, color-mix(in srgb, var(--color-primary) 8%, transparent))'
                        : 'transparent',
                      transition: 'all 0.15s ease',
                      borderLeft: isSelected ? '3px solid var(--color-primary)' : '3px solid transparent'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '4px'
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'Consolas, monospace',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: isSelected ? 'var(--color-primary)' : 'var(--color-text)'
                        }}
                      >
                        {proc.id}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 600,
                          background: isRunning
                            ? 'color-mix(in srgb, var(--color-success, #10b981) 12%, transparent)'
                            : isError
                              ? 'color-mix(in srgb, var(--color-danger, #ef4444) 12%, transparent)'
                              : 'var(--color-border)',
                          color: isRunning
                            ? 'var(--color-success, #10b981)'
                            : isError
                              ? 'var(--color-danger, #ef4444)'
                              : 'var(--color-text-muted)'
                        }}
                      >
                        {isRunning ? '运行中' : proc.status === 'stopped' ? '已停止' : proc.status === 'exited' ? '已退出' : '异常'}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '12px',
                        color: 'var(--color-text-muted)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontFamily: 'Consolas, monospace'
                      }}
                      title={proc.command}
                    >
                      {proc.command}
                    </div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--color-text-muted)',
                        marginTop: '4px',
                        display: 'flex',
                        justifyContent: 'space-between'
                      }}
                    >
                      <span>PID: {proc.pid ?? 'n/a'}</span>
                      <span>{new Date(proc.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Right panel: Terminal & Controls */}
          <div
            style={{
              flex: '1 1 auto',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              backgroundColor: '#0a0a0a'
            }}
          >
            {selectedProcess ? (
              <>
                {/* Control bar */}
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #222',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: '#121212'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '13px',
                        color: '#eee',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontFamily: 'Consolas, monospace'
                      }}
                    >
                      {selectedProcess.command}
                    </div>
                    <span style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                      工作目录: {selectedProcess.id} · 创建于{' '}
                      {new Date(selectedProcess.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {selectedProcess.status === 'running' && (
                    <button
                      type="button"
                      onClick={() => handleStop(selectedProcess.id)}
                      style={{
                        backgroundColor: 'var(--color-danger, #ef4444)',
                        border: 'none',
                        color: '#fff',
                        cursor: 'pointer',
                        padding: '6px 12px',
                        borderRadius: '4px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        transition: 'opacity 0.15s ease'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                    >
                      <Power size={13} />
                      终止进程
                    </button>
                  )}
                </div>

                {/* Console Log Screen */}
                <div
                  style={{
                    flex: '1 1 auto',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative'
                  }}
                >
                  <pre
                    ref={logTerminalRef}
                    style={{
                      flex: '1 1 auto',
                      overflow: 'auto',
                      margin: 0,
                      padding: '16px',
                      color: '#00ff66',
                      fontFamily: 'Consolas, "Courier New", monospace',
                      fontSize: '12px',
                      lineHeight: '1.5',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all'
                    }}
                  >
                    {logs}
                  </pre>
                  {isLoadingLogs && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        color: '#aaa',
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <RefreshCw size={11} className="spin" />
                      加载中
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div
                style={{
                  flex: '1 1 auto',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#666',
                  gap: '12px'
                }}
              >
                <Terminal size={32} style={{ opacity: 0.3 }} />
                <span style={{ fontSize: '13px' }}>请从左侧选择一个后台进程以查看其实时控制台日志。</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
