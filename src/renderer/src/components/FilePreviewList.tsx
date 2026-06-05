import React from 'react'
import { Paperclip, X } from 'lucide-react'

interface FilePreviewListProps {
  attachedFiles: Array<{ name: string; content: string; type: string }>
  onRemoveFile: (idx: number) => void
}

export const FilePreviewList: React.FC<FilePreviewListProps> = ({
  attachedFiles,
  onRemoveFile
}) => {
  if (attachedFiles.length === 0) return null

  return (
    <div style={{ padding: '0 16px', background: 'rgba(15, 15, 18, 0.4)' }}>
      <div className="file-preview-list">
        {attachedFiles.map((file, idx) => (
          <div key={idx} className="file-preview-card">
            <Paperclip size={12} />
            <span
              style={{
                maxWidth: '120px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {file.name}
            </span>
            <button className="remove-file-btn" onClick={() => onRemoveFile(idx)}>
              <X size={10} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
