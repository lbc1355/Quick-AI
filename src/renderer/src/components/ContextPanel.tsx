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
  ContextCompositionGroupKind,
  ContextCompositionRole,
  ContextCompositionSegment,
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

const cacheReasonLabels: Record<string, string> = {
  system: '系统提示变化',
  tools: '工具 schema 变化',
  context_retention: '上下文保留模式变化',
  message_content: '历史消息内容变化',
  message_shape: '消息结构非追加',
  tool_call_duplication: '工具上下文重复'
}

const getUsageTone = (percent: number): 'ok' | 'warn' | 'danger' => {
  if (percent >= 90) return 'danger'
  if (percent >= 70) return 'warn'
  return 'ok'
}

const contextRoleLabels: Record<ContextCompositionRole, string> = {
  system: 'system',
  tool_call: 'tool call',
  tool: 'tool',
  user: 'user',
  assistant: 'assistant'
}

const formatChars = (chars: number): string => `${Math.max(0, chars).toLocaleString()} chars`
const formatRolePercent = (chars: number, totalChars: number): string => {
  if (!totalChars || chars <= 0) return '0%'
  const percent = (chars / totalChars) * 100
  if (percent > 0 && percent < 0.1) return '<0.1%'
  const rounded = Number(percent.toFixed(1))
  return rounded % 1 === 0 ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`
}

interface ContextCompositionRenderGroup {
  id: string
  kind?: ContextCompositionGroupKind
  label?: string
  segments: ContextCompositionSegment[]
}

const buildSegmentTitle = (segment: ContextCompositionSegment): string =>
  [
    `${contextRoleLabels[segment.role]} \u00b7 ${formatChars(segment.textLength)}`,
    segment.label !== contextRoleLabels[segment.role] ? segment.label : undefined,
    segment.preview
  ]
    .filter(Boolean)
    .join('\n')

const buildSegmentGroups = (
  segments: ContextCompositionSegment[]
): ContextCompositionRenderGroup[] => {
  const groups: ContextCompositionRenderGroup[] = []

  for (const segment of segments) {
    const id = segment.groupId || segment.id
    const lastGroup = groups[groups.length - 1]

    if (lastGroup?.id === id) {
      lastGroup.segments.push(segment)
      continue
    }

    groups.push({
      id,
      kind: segment.groupKind,
      label: segment.groupLabel,
      segments: [segment]
    })
  }

  return groups
}

const buildGroupTitle = (group: ContextCompositionRenderGroup): string => {
  const totalChars = group.segments.reduce((total, segment) => total + segment.textLength, 0)
  const roleSummary = group.segments
    .map((segment) => contextRoleLabels[segment.role] + ': ' + formatChars(segment.textLength))
    .join('\n')

  return [
    (group.label || 'Context group') +
      ' - ' +
      group.segments.length.toLocaleString() +
      ' segments - ' +
      formatChars(totalChars),
    roleSummary
  ]
    .filter(Boolean)
    .join('\n')
}

const ContextCompositionGrid: React.FC<{ segments: ContextCompositionSegment[] }> = ({
  segments
}) => {
  const totalChars = segments.reduce((total, segment) => total + segment.textLength, 0)
  const roles = Object.keys(contextRoleLabels) as ContextCompositionRole[]
  const roleStats = roles.reduce(
    (stats, role) => {
      stats[role] = { chars: 0, count: 0 }
      return stats
    },
    {} as Record<ContextCompositionRole, { chars: number; count: number }>
  )

  for (const segment of segments) {
    roleStats[segment.role].chars += segment.textLength
    roleStats[segment.role].count += 1
  }

  const groups = buildSegmentGroups(segments)
  const groupTitles = new Map(groups.map((group) => [group.id, buildGroupTitle(group)]))

  return (
    <div className="context-role-composition">
      <div className="context-role-summary">
        <span>{segments.length.toLocaleString()} segments</span>
        <span>{formatChars(totalChars)}</span>
      </div>
      <div className="context-role-cells" aria-label="Context message roles">
        {segments.length > 0 ? (
          segments.map((segment, index) => {
            const groupId = segment.groupId || segment.id
            const previousGroupId =
              index > 0 ? segments[index - 1].groupId || segments[index - 1].id : undefined
            const nextGroupId =
              index < segments.length - 1
                ? segments[index + 1].groupId || segments[index + 1].id
                : undefined
            const groupTitle = groupTitles.get(groupId)
            const segmentTitle = buildSegmentTitle(segment)
            const title = [groupTitle, segmentTitle].filter(Boolean).join('\n\n')

            return (
              <span
                key={segment.id}
                className={`context-role-cell-slot kind-${segment.groupKind || 'plain'} ${
                  previousGroupId === groupId ? 'group-continued-before' : 'group-start'
                } ${nextGroupId === groupId ? 'group-continued-after' : 'group-end'}`}
                title={title}
                aria-label={title}
              >
                <span
                  className={`context-role-cell role-${segment.role}`}
                  title={segmentTitle}
                  aria-label={segmentTitle}
                  tabIndex={0}
                />
              </span>
            )
          })
        ) : (
          <span className="context-role-empty">No context messages</span>
        )}
      </div>
      <div className="context-role-legend">
        {roles.map((role) => {
          const stats = roleStats[role]
          const percent = formatRolePercent(stats.chars, totalChars)
          const title = `${contextRoleLabels[role]} · ${percent}\n${formatChars(stats.chars)} · ${stats.count.toLocaleString()} segments`

          return (
            <span className="context-role-legend-item" key={role} title={title}>
              <span className={`context-role-legend-dot role-${role}`} />
              <span>{contextRoleLabels[role]}</span>
              <span className="context-role-legend-share">{percent}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

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
  const cacheShapeDiagnostics = cache.latestDiagnostics
  const cacheShapeStatus = !cacheShapeDiagnostics
    ? '暂无诊断'
    : cacheShapeDiagnostics.prefixChanged
      ? '发生变化'
      : cacheShapeDiagnostics.appendOnlyFromPrevious === false
        ? '非追加'
        : '稳定'
  const cacheShapeDetail = cacheShapeDiagnostics
    ? cacheShapeDiagnostics.prefixChangeReasons.length > 0
      ? cacheShapeDiagnostics.prefixChangeReasons
          .map((reason) => cacheReasonLabels[reason] || reason)
          .join('、')
      : cacheShapeDiagnostics.appendOnlyFromPrevious === undefined
        ? '当前进程内首次请求'
        : 'append-only 前缀保持稳定'
    : undefined
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
            <ContextCompositionGrid segments={diagnostics.compositionSegments} />
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
                icon={<Gauge size={13} />}
                label="缓存结构"
                value={cacheShapeStatus}
                detail={cacheShapeDetail}
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
