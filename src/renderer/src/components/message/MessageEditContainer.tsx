import React from 'react'

interface MessageEditContainerProps {
  editingText: string
  onChange: (text: string) => void
  onCancel: () => void
  onSave: () => void
}

export const MessageEditContainer = React.memo<MessageEditContainerProps>(
  ({ editingText, onChange, onCancel, onSave }) => {
    return (
      <div className="message-edit-container">
        <textarea
          className="message-edit-textarea"
          value={editingText}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="message-edit-actions">
          <button className="edit-btn cancel" onClick={onCancel}>
            取消
          </button>
          <button className="edit-btn save" onClick={onSave}>
            保存并重发
          </button>
        </div>
      </div>
    )
  }
)

MessageEditContainer.displayName = 'MessageEditContainer'
