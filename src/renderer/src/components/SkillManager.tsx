import React, { useEffect, useRef, useState } from 'react'
import { Trash2, Upload } from 'lucide-react'
import { Skill } from '../../../shared/types'

interface SkillManagerProps {
  skills: Skill[]
  onInstallSkill: (fileName: string, markdown: string) => Promise<Skill>
  onRemoveSkill: (id: string) => Promise<void>
}

export const SkillManager: React.FC<SkillManagerProps> = ({
  skills,
  onInstallSkill,
  onRemoveSkill
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [statusText, setStatusText] = useState('')
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    const input = fileInputRef.current
    if (!input) return

    const handleCancel = (): void => {
      window.api.setFilePickerActive(false)
      window.api.reSummonWindow()
    }

    input.addEventListener('cancel', handleCancel)
    return () => {
      input.removeEventListener('cancel', handleCancel)
    }
  }, [])

  const handleInstallClick = (): void => {
    setStatusText('')
    setErrorText('')
    window.api.setFilePickerActive(true)
    fileInputRef.current?.click()
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      window.api.setFilePickerActive(false)
      return
    }

    const reader = new FileReader()
    reader.onload = (): void => {
      const markdown = typeof reader.result === 'string' ? reader.result : ''
      onInstallSkill(file.name, markdown)
        .then((skill) => {
          setStatusText(`已安装 /${skill.trigger}`)
          setErrorText('')
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          setErrorText(message)
          setStatusText('')
        })
        .finally(() => {
          window.api.setFilePickerActive(false)
        })
    }
    reader.onerror = (): void => {
      setErrorText('读取 Skill 文件失败')
      setStatusText('')
      window.api.setFilePickerActive(false)
    }
    reader.readAsText(file, 'utf-8')
  }

  const handleRemoveSkill = (id: string): void => {
    onRemoveSkill(id)
      .then(() => {
        setStatusText('Skill 已删除')
        setErrorText('')
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setErrorText(message)
        setStatusText('')
      })
  }

  return (
    <section className="skill-manager">
      <div className="skill-manager-header">
        <span
          className="settings-label"
          style={{ fontSize: '13.5px', color: 'var(--color-text-title)', fontWeight: 'bold' }}
        >
          Markdown Skills
        </span>
        <button
          className="settings-save-btn skill-install-btn"
          onClick={handleInstallClick}
          title="安装 Markdown Skill"
        >
          <Upload size={12} />
          <span>安装 Skill</span>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {skills.length === 0 ? (
        <div className="skill-empty">暂无已安装 Skill</div>
      ) : (
        <div className="skill-list">
          {skills.map((skill) => {
            const triggers = skill.triggers && skill.triggers.length > 0 ? skill.triggers : [skill.trigger]
            return (
              <div key={skill.id} className="skill-card">
                <div className="skill-card-main">
                  <div className="skill-card-title-row">
                    <span className="skill-card-title">{skill.name}</span>
                    <span className="skill-card-mode">{skill.mode || 'insert'}</span>
                  </div>
                  <div className="skill-trigger-row">
                    {triggers.map((trigger) => (
                      <span key={trigger} className="skill-trigger-pill">
                        /{trigger}
                      </span>
                    ))}
                  </div>
                  {skill.description && (
                    <div className="skill-description">{skill.description}</div>
                  )}
                </div>
                <button
                  className="skill-remove-btn"
                  onClick={() => handleRemoveSkill(skill.id)}
                  title="删除 Skill"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {(statusText || errorText) && (
        <div className={errorText ? 'skill-status error' : 'skill-status'}>
          {errorText || statusText}
        </div>
      )}
    </section>
  )
}
