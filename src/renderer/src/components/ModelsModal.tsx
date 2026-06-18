import React, { useMemo, useState } from 'react'
import { Search, X, Minus, Plus } from 'lucide-react'

interface ModelsModalProps {
  fetchedModels: string[]
  modelsList: string[]
  onToggleModel: (modelId: string) => void
  onClose: () => void
}

export const ModelsModal: React.FC<ModelsModalProps> = ({
  fetchedModels,
  modelsList,
  onToggleModel,
  onClose
}) => {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filteredModels = useMemo(
    () =>
      normalizedQuery
        ? fetchedModels.filter((modelId) => modelId.toLowerCase().includes(normalizedQuery))
        : fetchedModels,
    [fetchedModels, normalizedQuery]
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            获取到的模型列表 ({filteredModels.length}/{fetchedModels.length})
          </span>
          <button className="header-action-btn" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="modal-search-row">
          <Search size={14} />
          <input
            className="modal-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索模型..."
            autoFocus
          />
        </div>
        <div className="modal-body">
          {filteredModels.length === 0 && <div className="modal-empty-state">没有匹配的模型</div>}
          {filteredModels.map((modelId) => {
            const isAdded = modelsList.includes(modelId)
            return (
              <div key={modelId} className="modal-list-item">
                <span className="modal-model-id" title={modelId}>
                  {modelId}
                </span>
                {isAdded ? (
                  <button
                    className="modal-action-btn remove"
                    onClick={() => onToggleModel(modelId)}
                    title="移除此模型"
                  >
                    <Minus size={14} />
                  </button>
                ) : (
                  <button
                    className="modal-action-btn add"
                    onClick={() => onToggleModel(modelId)}
                    title="添加此模型"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <div className="modal-footer">
          <button className="modal-close-btn" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
