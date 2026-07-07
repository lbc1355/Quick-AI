import React, { useMemo, useState } from 'react'
import { Search, X, Minus, Plus } from 'lucide-react'
import { FetchedModelInfo } from '../../../shared/types'

interface ModelsModalProps {
  fetchedModels: FetchedModelInfo[]
  modelsList: string[]
  onToggleModel: (model: FetchedModelInfo) => void
  onClose: () => void
}

const TEXT = {
  title: '\u83b7\u53d6\u5230\u7684\u6a21\u578b\u5217\u8868',
  close: '\u5173\u95ed',
  search: '\u641c\u7d22\u6a21\u578b...',
  empty: '\u6ca1\u6709\u5339\u914d\u7684\u6a21\u578b',
  remove: '\u79fb\u9664\u6b64\u6a21\u578b',
  add: '\u6dfb\u52a0\u6b64\u6a21\u578b',
  done: '\u5b8c\u6210'
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
        ? fetchedModels.filter((model) =>
            `${model.id} ${model.displayName || ''}`.toLowerCase().includes(normalizedQuery)
          )
        : fetchedModels,
    [fetchedModels, normalizedQuery]
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            {TEXT.title} ({filteredModels.length}/{fetchedModels.length})
          </span>
          <button className="header-action-btn" onClick={onClose} title={TEXT.close}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-search-row">
          <Search size={14} />
          <input
            className="modal-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={TEXT.search}
            autoFocus
          />
        </div>
        <div className="modal-body">
          {filteredModels.length === 0 && <div className="modal-empty-state">{TEXT.empty}</div>}
          {filteredModels.map((model) => {
            const isAdded = modelsList.includes(model.id)
            return (
              <div key={model.id} className="modal-list-item">
                <span className="modal-model-id" title={model.displayName || model.id}>
                  {model.id}
                </span>
                {isAdded ? (
                  <button
                    className="modal-action-btn remove"
                    onClick={() => onToggleModel(model)}
                    title={TEXT.remove}
                  >
                    <Minus size={14} />
                  </button>
                ) : (
                  <button
                    className="modal-action-btn add"
                    onClick={() => onToggleModel(model)}
                    title={TEXT.add}
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
            {TEXT.done}
          </button>
        </div>
      </div>
    </div>
  )
}
