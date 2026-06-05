import React from 'react'
import { X, Minus, Plus } from 'lucide-react'

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
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">获取到的模型列表 ({fetchedModels.length})</span>
          <button className="header-action-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          {fetchedModels.map((modelId) => {
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
