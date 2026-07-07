import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Info, AlertTriangle, CheckCircle2, XCircle, X } from 'lucide-react'

export interface ToastMessage {
  id: string
  type: 'info' | 'warning' | 'success' | 'error'
  text: string
  duration: number
}

export interface ToastActionsType {
  info: (text: string, duration?: number) => void
  warning: (text: string, duration?: number) => void
  success: (text: string, duration?: number) => void
  error: (text: string, duration?: number) => void
  removeToast: (id: string) => void
}

const ToastStateContext = createContext<ToastMessage[] | undefined>(undefined)
const ToastActionsContext = createContext<ToastActionsType | undefined>(undefined)

const DEFAULT_DURATIONS = {
  info: 3000,
  success: 3000,
  warning: 4000,
  error: 5000
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback(
    (type: ToastMessage['type'], text: string, customDuration?: number) => {
      setToasts((prev) => {
        // 1. 同文案短时间去重
        if (prev.some((t) => t.text === text)) {
          return prev
        }

        const id = Math.random().toString(36).substring(2, 9)
        const duration = customDuration ?? DEFAULT_DURATIONS[type]

        const newToast: ToastMessage = { id, type, text, duration }

        // 自动移除定时器
        setTimeout(() => {
          removeToast(id)
        }, duration)

        // 2. 支持 maxVisible = 3
        const nextToasts = [...prev, newToast]
        if (nextToasts.length > 3) {
          return nextToasts.slice(nextToasts.length - 3)
        }
        return nextToasts
      })
    },
    [removeToast]
  )

  const info = useCallback(
    (text: string, duration?: number) => addToast('info', text, duration),
    [addToast]
  )
  const warning = useCallback(
    (text: string, duration?: number) => addToast('warning', text, duration),
    [addToast]
  )
  const success = useCallback(
    (text: string, duration?: number) => addToast('success', text, duration),
    [addToast]
  )
  const error = useCallback(
    (text: string, duration?: number) => addToast('error', text, duration),
    [addToast]
  )

  return (
    <ToastStateContext.Provider value={toasts}>
      <ToastActionsContext.Provider value={{ info, warning, success, error, removeToast }}>
        {children}
        <ToastContainer />
      </ToastActionsContext.Provider>
    </ToastStateContext.Provider>
  )
}

export function useToast(): ToastActionsType {
  const context = useContext(ToastActionsContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

export function useToastState(): ToastMessage[] {
  const context = useContext(ToastStateContext)
  if (!context) {
    throw new Error('useToastState must be used within a ToastProvider')
  }
  return context
}

function ToastContainer(): React.JSX.Element {
  const toasts = useToastState()
  const { removeToast } = useToast()
  const [mountNode, setMountNode] = useState<Element | null>(null)

  useEffect(() => {
    const node = document.querySelector('.app-container') || document.body
    setMountNode(node)
  }, [])

  if (!mountNode) {
    return <></>
  }

  return createPortal(
    <div className="toast-container">
      {toasts.map((toast) => {
        let Icon = Info
        let iconColor = 'var(--color-text-muted)'
        if (toast.type === 'success') {
          Icon = CheckCircle2
          iconColor = 'var(--color-status-success)'
        } else if (toast.type === 'warning') {
          Icon = AlertTriangle
          iconColor = 'var(--color-status-warning)'
        } else if (toast.type === 'error') {
          Icon = XCircle
          iconColor = 'var(--color-status-danger)'
        }

        return (
          <div key={toast.id} className={`toast-item toast-${toast.type}`}>
            <div className="toast-icon-wrapper">
              <Icon size={16} style={{ color: iconColor }} />
            </div>
            <span className="toast-text">{toast.text}</span>
            <button className="toast-close-btn" onClick={() => removeToast(toast.id)}>
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>,
    mountNode
  )
}
