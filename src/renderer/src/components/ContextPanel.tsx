import React, { useEffect } from 'react'
import {
  Activity,
  Database,
  FileText,
  Gauge,
  History,
  Info,
  Settings2,
  Wrench,
  X
} from 'lucide-react'
import {
  buildContextUsageBreakdown,
  formatUsagePercent,
  formatCacheRate
} from '../utils/contextDiagnostics'
import type {
  ContextDiagnosticsSnapshot,
  ContextUsageBreakdown
} from '../utils/contextDiagnostics'

interface AttachedFile {
  name: string
  content: string
  type: string
}

interface ContextPanelProps {
  diagnostics: ContextDiagnosticsSnapshot
  draftTokens: number
  attachedFiles: AttachedFile[]
  onClose: () => void
}

interface ContextPanelMetric {
  label: string
  value: string
  detail?: string
}

const sourceLabelMap = {
  'model-catalog': '模型目录',
  configured: '模型配置',
  'model-name': '模型名推断',
  default: '默认 128k'
} as const

const formatTokens = (tokens: number): string => `${Math.max(0, tokens).toLocaleString()} tokens`

const formatMaybeTokens = (available: boolean, tokens: number): string =>
  available ? Math.max(0, tokens).toLocaleString() : '未返回'

const formatMaybeRate = (rate: number | undefined): string => formatCacheRate(rate) || '未返回'

const getUsageTone = (percent: number): 'ok' | 'warn' | 'danger' => {
  if (percent >= 90) return 'danger'
  if (percent >= 70) return 'warn'
  return 'ok'
}

const ProgressRow: React.FC<{
  label: string
  tokens: number
  percent: number
  description?: string
}> = ({ label, tokens, percent, description }) => (
  <div className="context-panel-progress-row">
    <div className="context-panel-progress-head">
      <span>{label}</span>
      <span>
        {formatTokens(tokens)} · {formatUsagePercent(percent)}
      </span>
    </div>
    <div className="context-panel-progress-track" aria-hidden="true">
      <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
    {description && <div className="context-panel-progress-desc">{description}</div>}
  </div>
)

const MetricGrid: React.FC<{ metrics: ContextPanelMetric[] }> = ({ metrics }) => (
  <div className="context-panel-metric-grid">
    {metrics.map((metric) => (
      <div className="context-panel-metric" key={metric.label}>
        <span>{metric.label}</span>
        <strong>{metric.value}</strong>
        {metric.detail && <small>{metric.detail}</small>}
      </div>
    ))}
  </div>
)

const FactorRow: React.FC<{
  icon: React.ReactNode
  label: string
  value: string
  detail?: string
}> = ({ icon, label, value, detail }) => (
  <div className="context-panel-factor-row">
    <span className="context-panel-factor-icon">{icon}</span>
    <span className="context-panel-factor-copy">
      <strong>{label}</strong>
      {detail && <small>{detail}</small>}
    </span>
    <span className="context-panel-factor-value">{value}</span>
  </div>
)

export const ContextPanel: React.FC<ContextPanelProps> = ({
  diagnostics,
  draftTokens,
  attachedFiles,
  onClose
}) => {
  const usage: ContextUsageBreakdown = buildContextUsageBreakdown({ draftTokens, diagnostics })
  const usageTone = getUsageTone(usage.totalPercent)
  const tokenUsage = diagnostics.tokenUsage
  const apiUsageAvailable = tokenUsage.hasApiUsage
  const cache = diagnostics.cache
  const cacheTokenTotal = cache.hitTokens + cache.missTokens
  const contextSource = diagnostics.contextWindowSource || 'default'
  const contextRingStyle = {
    '--context-panel-progress-angle': `${usage.totalPercent * 3.6}deg`
  } as React.CSSProperties

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  return (
    <div className="context-panel-backdrop" onClick={onClose}>
      <aside
        className="context-panel"
        aria-label="上下文详情"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="context-panel-header">
          <div>
            <span className="context-panel-kicker">Context</span>
            <h2>上下文详情</h2>
          </div>
          <button type="button" className="context-panel-close" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </header>

        <section className="context-panel-summary">
          <div className={`context-panel-ring ${usageTone}`} style={contextRingStyle}>
            <span>{formatUsagePercent(usage.totalPercent)}</span>
          </div>
          <div className="context-panel-summary-copy">
            <div className="context-panel-model-line">
              <strong>{diagnostics.modelName || '当前模型'}</strong>
              <span>{sourceLabelMap[contextSource]}</span>
            </div>
            <div className="context-panel-total-line">
              {formatTokens(usage.totalTokens)} / {formatTokens(usage.contextWindowTokens)}
            </div>
            <p>
              这是前端估算的下一次请求上下文占用。未知模型默认按 128k 计算，真实窗口仍以服务商为准。
            </p>
          </div>
        </section>

        <div className="context-panel-body">
          <section className="context-panel-section">
            <div className="context-panel-section-title">
              <Gauge size={14} />
              <span>上下文组成</span>
            </div>
            <ProgressRow
              label="Conversation"
              tokens={usage.conversationTokens}
              percent={usage.conversationPercent}
              description="历史消息、当前输入和附件估算。"
            />
            <ProgressRow
              label="MCP/tools"
              tokens={usage.mcpToolTokens}
              percent={usage.mcpToolPercent}
              description="工具 schema 或 MCP 相关上下文。"
            />
            <ProgressRow
              label="Steering files"
              tokens={usage.steeringTokens}
              percent={usage.steeringPercent}
              description="系统提示、项目上下文、资源摘要。"
            />
          </section>

          <section className="context-panel-section">
            <div className="context-panel-section-title">
              <Activity size={14} />
              <span>API token 统计</span>
            </div>
            <MetricGrid
              metrics={[
                {
                  label: '输入',
                  value: formatMaybeTokens(apiUsageAvailable, tokenUsage.promptTokens)
                },
                {
                  label: '输出',
                  value: formatMaybeTokens(apiUsageAvailable, tokenUsage.completionTokens)
                },
                {
                  label: '推理',
                  value:
                    tokenUsage.reasoningTokens > 0
                      ? tokenUsage.reasoningTokens.toLocaleString()
                      : '未返回'
                },
                {
                  label: '总计',
                  value: formatMaybeTokens(apiUsageAvailable, tokenUsage.totalTokens),
                  detail: `${tokenUsage.sampleCount} 次样本`
                }
              ]}
            />
          </section>

          <section className="context-panel-section">
            <div className="context-panel-section-title">
              <Database size={14} />
              <span>缓存命中</span>
            </div>
            <MetricGrid
              metrics={[
                {
                  label: '本轮',
                  value: formatMaybeRate(cache.latestHitRate)
                },
                {
                  label: '会话平均',
                  value: formatMaybeRate(cache.averageHitRate)
                },
                {
                  label: '命中',
                  value: cacheTokenTotal > 0 ? cache.hitTokens.toLocaleString() : '未返回'
                },
                {
                  label: '未命中',
                  value: cacheTokenTotal > 0 ? cache.missTokens.toLocaleString() : '未返回',
                  detail: `${cache.sampleCount} 次样本`
                }
              ]}
            />
          </section>

          <section className="context-panel-section">
            <div className="context-panel-section-title">
              <Info size={14} />
              <span>影响 prefix/cache 的因素</span>
            </div>
            <div className="context-panel-factor-list">
              <FactorRow
                icon={<Settings2 size={13} />}
                label="系统提示"
                value={diagnostics.hasSystemPrompt ? '已启用' : '未启用'}
              />
              <FactorRow
                icon={<FileText size={13} />}
                label="项目上下文"
                value={diagnostics.projectLabel ? '已绑定' : '自由对话'}
                detail={diagnostics.projectLabel}
              />
              <FactorRow
                icon={<Database size={13} />}
                label="资源摘要"
                value={`${diagnostics.resourceCount} 个`}
                detail={diagnostics.resourceCount > 0 ? '资源更新可能改变前缀内容。' : undefined}
              />
              <FactorRow
                icon={<Wrench size={13} />}
                label="工具权限"
                value={`${diagnostics.customPermissionCount} 项`}
                detail="非默认权限会进入 agent 前缀。"
              />
              <FactorRow
                icon={<History size={13} />}
                label="技能目录"
                value={`${diagnostics.skillCount} 个`}
                detail="技能增删可能改变 agent 前缀。"
              />
            </div>
          </section>

          <section className="context-panel-section compact">
            <div className="context-panel-section-title">
              <History size={14} />
              <span>当前会话</span>
            </div>
            <div className="context-panel-session-line">
              <span>{diagnostics.messageCount} 条历史消息</span>
              <span>{attachedFiles.length} 个待发送附件</span>
              <span>当前输入约 {formatTokens(draftTokens)}</span>
            </div>
          </section>
        </div>
      </aside>
    </div>
  )
}
