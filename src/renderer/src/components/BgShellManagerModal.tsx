import React, { useState, useEffect, useRef } from 'react'
import { X, Terminal, Power, RefreshCw, Layers, Info } from 'lucide-react'

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
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedId

  const [logs, setLogs] = useState<string>('')
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const logTerminalRef = useRef<HTMLPreElement>(null)

  const fetchList = async (silent = false): Promise<void> => {
    if (!silent) setIsLoadingList(true)
    try {
      const list = await window.api.bgShellList(sessionId)
      setProcesses(list)
      const currentSelected = selectedIdRef.current
      if (list.length > 0) {
        if (!currentSelected || !list.some((p) => p.id === currentSelected)) {
          setSelectedId(list[0].id)
        }
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
    <div className="bg-shell-overlay">
      <div className="bg-shell-dialog">
        {/* Header */}
        <div className="bg-shell-header">
          <div className="bg-shell-header-title">
            <Layers size={16} style={{ color: 'var(--color-primary)' }} />
            <h2>后台进程管理</h2>
            <span>{processes.length} 个进程</span>
          </div>
          <div className="bg-shell-header-actions">
            <button
              type="button"
              className="bg-shell-icon-btn"
              onClick={() => fetchList()}
              disabled={isLoadingList}
              title="刷新列表"
            >
              <RefreshCw size={14} className={isLoadingList ? 'spin' : ''} />
            </button>
            <button type="button" className="bg-shell-icon-btn" onClick={onClose} title="关闭窗口">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="bg-shell-body">
          {/* Left Panel: Sidebar */}
          <div className="bg-shell-sidebar">
            {processes.length === 0 ? (
              <div
                style={{
                  padding: '40px 20px',
                  textAlign: 'center',
                  color: 'var(--color-text-faint)',
                  fontSize: '12px'
                }}
              >
                当前会话没有运行中的后台进程。
              </div>
            ) : (
              processes.map((proc) => {
                const isSelected = proc.id === selectedId
                return (
                  <div
                    key={proc.id}
                    onClick={() => setSelectedId(proc.id)}
                    className={`bg-shell-item ${isSelected ? 'selected' : ''}`}
                  >
                    <div className="bg-shell-item-left">
                      <span className={`bg-shell-status-dot ${proc.status}`} />
                      <span className="bg-shell-item-id">{proc.id}</span>
                      <span className="bg-shell-item-cmd-preview" title={proc.command}>
                        {proc.command}
                      </span>
                    </div>
                    <span className="bg-shell-item-pid">PID: {proc.pid ?? 'n/a'}</span>
                  </div>
                )
              })
            )}
          </div>

          {/* Right Panel: Content View */}
          <div className="bg-shell-content">
            {selectedProcess ? (
              <>
                {/* Terminal Control Bar */}
                <div className="bg-shell-terminal-header">
                  <div className="bg-shell-terminal-info">
                    <div className="bg-shell-terminal-command">工作目录: {selectedProcess.id}</div>
                    <span className="bg-shell-terminal-meta">
                      PID: {selectedProcess.pid ?? 'n/a'} · 创建于{' '}
                      {new Date(selectedProcess.createdAt).toLocaleString()}
                      <span
                        title={selectedProcess.command}
                        style={{
                          marginLeft: '8px',
                          cursor: 'help',
                          display: 'inline-flex',
                          alignItems: 'center',
                          verticalAlign: 'middle'
                        }}
                      >
                        <Info size={11} style={{ opacity: 0.6 }} />
                      </span>
                    </span>
                  </div>
                  {selectedProcess.status === 'running' && (
                    <button
                      type="button"
                      className="bg-shell-terminate-btn"
                      onClick={() => handleStop(selectedProcess.id)}
                      title="终止进程"
                    >
                      <Power size={14} />
                    </button>
                  )}
                </div>

                {/* Console Log Screen */}
                <div className="bg-shell-terminal-container">
                  <pre ref={logTerminalRef} className="bg-shell-terminal-screen">
                    {logs}
                  </pre>
                  {isLoadingLogs && (
                    <div className="bg-shell-terminal-loading">
                      <RefreshCw size={10} className="spin" />
                      加载中
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="bg-shell-content-empty">
                <Terminal size={32} style={{ opacity: 0.3 }} />
                <span>请从左侧选择一个后台进程以查看其实时控制台日志。</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
