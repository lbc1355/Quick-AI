import React from 'react'
import { X } from 'lucide-react'
import type { ParsedToolCall } from '../../utils/messageFormat'
import { getShellCommandArg, getToolArgsJson, getToolStatusLabel } from './toolDisplay'

export const ToolDetailModal: React.FC<{
  toolCall: ParsedToolCall
  onClose: () => void
}> = ({ toolCall, onClose }) => {
  const shellCommand = getShellCommandArg(toolCall.toolName, toolCall.args)
  const argsJson = shellCommand ? '' : getToolArgsJson(toolCall.args)
  const result = toolCall.result
  const outputDetails = result?.details || toolCall.output

  return (
    <div className="tool-detail-backdrop" onMouseDown={onClose}>
      <section
        className="tool-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${toolCall.toolName} 工具详情`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="tool-detail-header">
          <div className="tool-detail-title-group">
            <code className="tool-detail-name">{toolCall.toolName}</code>
            <span className={`tool-detail-status ${toolCall.status}`}>
              {getToolStatusLabel(toolCall.status)}
            </span>
          </div>
          <button type="button" className="tool-detail-close" onClick={onClose} title="关闭">
            <X size={15} />
          </button>
        </header>

        <div className="tool-detail-body">
          {toolCall.purpose && (
            <section className="tool-detail-section">
              <h4>说明</h4>
              <p>{toolCall.purpose}</p>
            </section>
          )}

          {shellCommand && (
            <section className="tool-detail-section">
              <h4>Command</h4>
              <pre className="tool-detail-code command">
                <code>{shellCommand}</code>
              </pre>
            </section>
          )}

          {argsJson && (
            <section className="tool-detail-section">
              <h4>调用参数</h4>
              <pre className="tool-detail-code">
                <code>{argsJson}</code>
              </pre>
            </section>
          )}

          {toolCall.error && (
            <section className="tool-detail-section">
              <h4>错误</h4>
              <pre className="tool-detail-code error">
                <code>{toolCall.error}</code>
              </pre>
            </section>
          )}

          {result && (
            <section className="tool-detail-section">
              <h4>执行结果</h4>
              <div className="tool-detail-result">
                {result.title && <div className="tool-detail-result-title">{result.title}</div>}
                {result.summary && (
                  <div className="tool-detail-result-summary">{result.summary}</div>
                )}
                {result.url && (
                  <a
                    className="tool-detail-result-url"
                    href={result.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {result.url}
                  </a>
                )}
                {outputDetails && (
                  <pre className="tool-detail-code details">
                    <code>{outputDetails}</code>
                  </pre>
                )}
                {result.items && result.items.length > 0 && (
                  <div className="tool-detail-result-items">
                    {result.items.map((item, itemIdx) => (
                      <div key={`${item.url}-${itemIdx}`} className="tool-detail-result-item">
                        <div className="tool-detail-result-item-header">
                          <span className="tool-detail-result-item-index">#{itemIdx + 1}</span>
                          <a href={item.url} target="_blank" rel="noreferrer">
                            {item.title}
                          </a>
                          {item.source && (
                            <span className="tool-detail-result-item-source">{item.source}</span>
                          )}
                        </div>
                        {item.snippet && (
                          <div className="tool-detail-result-item-snippet">{item.snippet}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {!result && outputDetails && (
            <section className="tool-detail-section">
              <h4>实时输出</h4>
              <pre className="tool-detail-code details">
                <code>{outputDetails}</code>
              </pre>
            </section>
          )}

          {!toolCall.purpose && !argsJson && !toolCall.error && !result && !outputDetails && (
            <section className="tool-detail-section">
              <p>这个工具调用没有返回额外详情。</p>
            </section>
          )}
        </div>
      </section>
    </div>
  )
}
