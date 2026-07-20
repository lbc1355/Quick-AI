import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Clock3, Info, Layers, Power, RefreshCw, Terminal, X } from 'lucide-react'
import type { BackgroundJobInfo, BackgroundJobStatus } from '../../../shared/types'
import { useToast } from '../contexts/ToastContext'

interface BackgroundShellInfo {
  id: string
  command: string
  status: string
  pid?: number
  createdAt: number
  totalOutputChars: number
}

interface BackgroundTaskManagerModalProps {
  sessionId?: string
  onClose: () => void
}

type ManagerTab = 'agents' | 'shells'

const statusLabels: Record<BackgroundJobStatus, string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  max_steps: '达到步数上限',
  interrupted: '已中断'
}

const formatTime = (value?: number): string => (value ? new Date(value).toLocaleString() : '—')

const formatDuration = (job: BackgroundJobInfo, now = Date.now()): string => {
  const duration = Math.max(0, (job.completedAt || now) - job.createdAt)
  if (duration < 1000) return `${duration} 毫秒`
  if (duration < 60_000) return `${Math.round(duration / 1000)} 秒`
  const minutes = Math.floor(duration / 60_000)
  const seconds = Math.round((duration % 60_000) / 1000)
  return `${minutes} 分 ${seconds} 秒`
}

export const BackgroundTaskManagerModal: React.FC<BackgroundTaskManagerModalProps> = ({
  sessionId,
  onClose
}) => {
  const toast = useToast()
  const [activeTab, setActiveTab] = useState<ManagerTab>('agents')
  const [jobs, setJobs] = useState<BackgroundJobInfo[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [shells, setShells] = useState<BackgroundShellInfo[]>([])
  const [selectedShellId, setSelectedShellId] = useState<string | null>(null)
  const [logs, setLogs] = useState('')
  const [isLoadingJobs, setIsLoadingJobs] = useState(false)
  const [isLoadingShells, setIsLoadingShells] = useState(false)
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const logTerminalRef = useRef<HTMLPreElement>(null)

  const fetchJobs = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setIsLoadingJobs(true)
      try {
        const list = await window.api.backgroundJobList(sessionId)
        setJobs(list)
        setSelectedJobId((current) =>
          current && list.some((job) => job.id === current) ? current : list[0]?.id || null
        )
      } catch (error) {
        console.error('Failed to fetch background jobs', error)
      } finally {
        setIsLoadingJobs(false)
      }
    },
    [sessionId]
  )

  const fetchShells = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setIsLoadingShells(true)
      try {
        const list = await window.api.bgShellList(sessionId)
        setShells(list)
        setSelectedShellId((current) =>
          current && list.some((shell) => shell.id === current) ? current : list[0]?.id || null
        )
      } catch (error) {
        console.error('Failed to fetch background shell processes', error)
      } finally {
        setIsLoadingShells(false)
      }
    },
    [sessionId]
  )

  const fetchLogs = useCallback(async (id: string, silent = false): Promise<void> => {
    if (!silent) setIsLoadingLogs(true)
    try {
      const result = await window.api.bgShellReadLog(id)
      setLogs(result.output || '(暂无日志输出)')
      window.setTimeout(() => {
        if (logTerminalRef.current) {
          logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight
        }
      }, 50)
    } catch (error) {
      console.error('Failed to read background shell logs', error)
      setLogs(`读取日志失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsLoadingLogs(false)
    }
  }, [])

  useEffect(() => {
    void fetchJobs()
    const timer = window.setInterval(() => void fetchJobs(true), 2000)
    return () => window.clearInterval(timer)
  }, [fetchJobs])

  useEffect(() => {
    void fetchShells()
    const timer = window.setInterval(() => void fetchShells(true), 3000)
    return () => window.clearInterval(timer)
  }, [fetchShells])

  useEffect(() => {
    if (!selectedShellId) {
      setLogs('')
      return undefined
    }
    void fetchLogs(selectedShellId)
    const timer = window.setInterval(() => void fetchLogs(selectedShellId, true), 2000)
    return () => window.clearInterval(timer)
  }, [fetchLogs, selectedShellId])

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId),
    [jobs, selectedJobId]
  )
  const selectedShell = useMemo(
    () => shells.find((shell) => shell.id === selectedShellId),
    [selectedShellId, shells]
  )

  const handleCancelJob = async (id: string): Promise<void> => {
    if (!window.confirm('确定要取消这个后台子 Agent 任务吗？')) return
    try {
      await window.api.backgroundJobCancel(id)
      await fetchJobs(true)
    } catch (error) {
      toast.error(`取消后台任务失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleStopShell = async (id: string): Promise<void> => {
    if (!window.confirm('确定要终止该后台进程及其所有子进程吗？')) return
    try {
      await window.api.bgShellStop(id)
      await fetchShells(true)
      await fetchLogs(id, true)
    } catch (error) {
      toast.error(`停止进程失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const isRefreshing = activeTab === 'agents' ? isLoadingJobs : isLoadingShells
  const refreshActiveTab = (): void => {
    if (activeTab === 'agents') void fetchJobs()
    else void fetchShells()
  }

  return (
    <div className="bg-shell-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="bg-shell-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="后台任务管理"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="bg-shell-header">
          <div className="bg-shell-header-title">
            <Layers size={16} style={{ color: 'var(--color-primary)' }} />
            <h2>后台任务管理</h2>
            <span>
              {jobs.length} 个 Agent · {shells.length} 个进程
            </span>
          </div>
          <div className="bg-shell-header-actions">
            <button
              type="button"
              className="bg-shell-icon-btn"
              onClick={refreshActiveTab}
              disabled={isRefreshing}
              title="刷新列表"
            >
              <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
            </button>
            <button type="button" className="bg-shell-icon-btn" onClick={onClose} title="关闭窗口">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="background-manager-tabs" role="tablist" aria-label="后台任务类型">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'agents'}
            className={activeTab === 'agents' ? 'active' : ''}
            onClick={() => setActiveTab('agents')}
          >
            <Bot size={14} />子 Agent
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'shells'}
            className={activeTab === 'shells' ? 'active' : ''}
            onClick={() => setActiveTab('shells')}
          >
            <Terminal size={14} />
            Shell 进程
          </button>
        </div>

        {activeTab === 'agents' ? (
          <div className="bg-shell-body">
            <div className="bg-shell-sidebar">
              {jobs.length === 0 ? (
                <div className="background-manager-empty-list">当前会话没有后台子 Agent 任务。</div>
              ) : (
                jobs.map((job) => (
                  <button
                    type="button"
                    key={job.id}
                    onClick={() => setSelectedJobId(job.id)}
                    className={`bg-shell-item ${job.id === selectedJobId ? 'selected' : ''}`}
                  >
                    <span className="bg-shell-item-left">
                      <span className={`bg-shell-status-dot ${job.status}`} />
                      <span className="background-job-item-copy">
                        <span className="background-job-item-title">{job.title}</span>
                        <span className="bg-shell-item-cmd-preview">
                          {job.description || job.id}
                        </span>
                      </span>
                    </span>
                    <span className="background-job-item-status">{statusLabels[job.status]}</span>
                  </button>
                ))
              )}
            </div>

            <div className="bg-shell-content background-job-content">
              {selectedJob ? (
                <>
                  <div className="bg-shell-terminal-header">
                    <div className="bg-shell-terminal-info">
                      <div className="bg-shell-terminal-command">{selectedJob.title}</div>
                      <span className={`background-job-status ${selectedJob.status}`}>
                        {statusLabels[selectedJob.status]}
                      </span>
                    </div>
                    {selectedJob.status === 'running' && (
                      <button
                        type="button"
                        className="bg-shell-terminate-btn"
                        onClick={() => void handleCancelJob(selectedJob.id)}
                      >
                        <Power size={14} />
                        取消任务
                      </button>
                    )}
                  </div>
                  <div className="background-job-details">
                    <section>
                      <h3>任务内容</h3>
                      <p>{selectedJob.description || selectedJob.title}</p>
                    </section>
                    <dl>
                      <div>
                        <dt>任务 ID</dt>
                        <dd>{selectedJob.id}</dd>
                      </div>
                      <div>
                        <dt>类型</dt>
                        <dd>{selectedJob.type}</dd>
                      </div>
                      <div>
                        <dt>开始时间</dt>
                        <dd>{formatTime(selectedJob.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>结束时间</dt>
                        <dd>{formatTime(selectedJob.completedAt)}</dd>
                      </div>
                      <div>
                        <dt>耗时</dt>
                        <dd className="background-job-duration">
                          <Clock3 size={12} />
                          {formatDuration(selectedJob)}
                        </dd>
                      </div>
                    </dl>
                    {selectedJob.error && (
                      <section className="background-job-error">
                        <h3>错误信息</h3>
                        <pre>{selectedJob.error}</pre>
                      </section>
                    )}
                    {selectedJob.status === 'interrupted' && (
                      <div className="background-job-note">
                        该任务所属的应用进程已经退出，因此无法从上次进度继续执行。
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="bg-shell-content-empty">
                  <Bot size={32} style={{ opacity: 0.3 }} />
                  <span>从左侧选择一个后台子 Agent 任务查看详情。</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-shell-body">
            <div className="bg-shell-sidebar">
              {shells.length === 0 ? (
                <div className="background-manager-empty-list">当前会话没有后台 Shell 进程。</div>
              ) : (
                shells.map((shell) => (
                  <button
                    type="button"
                    key={shell.id}
                    onClick={() => setSelectedShellId(shell.id)}
                    className={`bg-shell-item ${shell.id === selectedShellId ? 'selected' : ''}`}
                  >
                    <span className="bg-shell-item-left">
                      <span className={`bg-shell-status-dot ${shell.status}`} />
                      <span className="bg-shell-item-id">{shell.id}</span>
                      <span className="bg-shell-item-cmd-preview" title={shell.command}>
                        {shell.command}
                      </span>
                    </span>
                    <span className="bg-shell-item-pid">PID: {shell.pid ?? 'n/a'}</span>
                  </button>
                ))
              )}
            </div>

            <div className="bg-shell-content">
              {selectedShell ? (
                <>
                  <div className="bg-shell-terminal-header">
                    <div className="bg-shell-terminal-info">
                      <div className="bg-shell-terminal-command">{selectedShell.command}</div>
                      <span className="bg-shell-terminal-meta">
                        PID: {selectedShell.pid ?? 'n/a'} · 创建于{' '}
                        {formatTime(selectedShell.createdAt)}
                        <span className="background-shell-info" title={selectedShell.id}>
                          <Info size={11} />
                        </span>
                      </span>
                    </div>
                    {selectedShell.status === 'running' && (
                      <button
                        type="button"
                        className="bg-shell-terminate-btn"
                        onClick={() => void handleStopShell(selectedShell.id)}
                      >
                        <Power size={14} />
                        终止进程
                      </button>
                    )}
                  </div>
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
                  <span>从左侧选择一个后台 Shell 进程查看日志。</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
