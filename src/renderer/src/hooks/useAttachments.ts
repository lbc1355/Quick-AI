import { useState, useEffect, useRef, ChangeEvent, ClipboardEvent, DragEvent } from 'react'

export interface UseAttachmentsReturn {
  dragActive: boolean
  setDragActive: React.Dispatch<React.SetStateAction<boolean>>
  attachedFiles: Array<{ name: string; content: string; type: string }>
  setAttachedFiles: React.Dispatch<React.SetStateAction<Array<{ name: string; content: string; type: string }>>>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => void
  handlePaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void
  handleDrag: (e: DragEvent) => void
  handleDrop: (e: DragEvent) => void
  handleRemoveFile: (idx: number) => void
}

export const useAttachments = (textareaRef: React.RefObject<HTMLTextAreaElement | null>): UseAttachmentsReturn => {
  const [dragActive, setDragActive] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; content: string; type: string }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = fileInputRef.current
    if (!input) return

    const handleCancel = (): void => {
      window.api.reSummonWindow()
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
    }

    input.addEventListener('cancel', handleCancel)
    return () => {
      input.removeEventListener('cancel', handleCancel)
    }
  }, [textareaRef])

  const processFile = (file: File): void => {
    // 5MB size limit to prevent memory bloating
    const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE_BYTES) {
      alert(`文件 "${file.name}" 超过 5MB 大小限制，无法添加！`)
      return
    }

    const reader = new FileReader()
    if (file.type.startsWith('image/')) {
      reader.onload = (e) => {
        if (e.target?.result) {
          setAttachedFiles((prev) => [
            ...prev,
            {
              name: file.name,
              content: e.target!.result as string, // base64 URI
              type: 'image'
            }
          ])
        }
      }
      reader.readAsDataURL(file)
    } else {
      reader.onload = (e) => {
        if (e.target?.result) {
          setAttachedFiles((prev) => [
            ...prev,
            {
              name: file.name,
              content: e.target!.result as string,
              type: 'text'
            }
          ])
        }
      }
      reader.readAsText(file)
    }
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files) {
      Array.from(e.target.files).forEach(processFile)
    }
    e.target.value = ''
    window.api.reSummonWindow()
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 50)
  }

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile()
        if (file) {
          processFile(file)
        }
      }
    }
  }

  const handleDrag = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      Array.from(e.dataTransfer.files).forEach(processFile)
    }
  }

  const handleRemoveFile = (idx: number): void => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  return {
    dragActive,
    setDragActive,
    attachedFiles,
    setAttachedFiles,
    fileInputRef,
    handleFileChange,
    handlePaste,
    handleDrag,
    handleDrop,
    handleRemoveFile
  }
}
