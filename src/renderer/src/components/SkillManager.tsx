import React, { useEffect, useRef, useState } from 'react'
import { FolderOpen, Trash2, Upload } from 'lucide-react'
import { SkillInstallPayload, SkillPackageFile } from '../../../shared/types'
import { useSettings } from '../contexts/SettingsContext'

type DirectoryInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string
  directory?: string
}

interface SkillFolderEntry {
  file: File
  path: string
}

const TEXT_EXTENSIONS = new Set([
  'css',
  'csv',
  'cjs',
  'html',
  'ini',
  'js',
  'json',
  'jsonl',
  'jsx',
  'md',
  'mdx',
  'mjs',
  'ps1',
  'py',
  'rb',
  'rs',
  'sh',
  'sql',
  'toml',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml'
])

const IGNORED_PATH_SEGMENTS = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'dist',
  'node_modules',
  'out'
])

const MAX_SKILL_FILE_BYTES = 256 * 1024
const MAX_SKILL_PACKAGE_BYTES = 2 * 1024 * 1024

const directoryInputProps: DirectoryInputProps = {
  webkitdirectory: '',
  directory: ''
}

const normalizePath = (path: string): string =>
  path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')

const stripCommonRoot = (paths: string[]): ((path: string) => string) => {
  const firstSegments = paths.map((path) => path.split('/')[0]).filter(Boolean)
  if (firstSegments.length === 0) return (path) => path

  const root = firstSegments[0]
  const hasCommonRoot = firstSegments.every((segment) => segment === root)
  if (!hasCommonRoot) return (path) => path

  return (path) => {
    const parts = path.split('/')
    return parts.length > 1 ? parts.slice(1).join('/') : path
  }
}

const shouldIgnorePath = (path: string): boolean =>
  path.split('/').some((segment) => IGNORED_PATH_SEGMENTS.has(segment))

const isTextFile = (file: File, path: string): boolean => {
  const lower = path.toLowerCase()
  if (lower === 'skill.md' || lower.endsWith('/skill.md')) return true
  if (file.type.startsWith('text/')) return true

  const extension = lower.split('.').pop() || ''
  return TEXT_EXTENSIONS.has(extension)
}

const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (): void => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = (): void => reject(new Error('读取 Skill 文件失败'))
    reader.readAsText(file, 'utf-8')
  })
}

const readSkillFolderPayload = async (files: File[]): Promise<SkillInstallPayload> => {
  const rawEntries = files
    .map((file) => ({
      file,
      path: normalizePath(file.webkitRelativePath || file.name)
    }))
    .filter((entry) => entry.path && !shouldIgnorePath(entry.path))

  if (rawEntries.length === 0) {
    throw new Error('Skill 文件夹为空')
  }

  const stripRoot = stripCommonRoot(rawEntries.map((entry) => entry.path))
  const entries: SkillFolderEntry[] = rawEntries
    .map((entry) => ({
      file: entry.file,
      path: normalizePath(stripRoot(entry.path))
    }))
    .filter((entry) => entry.path && !shouldIgnorePath(entry.path))

  const entry =
    entries.find((item) => item.path.toLowerCase() === 'skill.md') ||
    entries
      .filter((item) => item.path.toLowerCase().endsWith('/skill.md'))
      .sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0]

  if (!entry) {
    throw new Error('Skill 文件夹需要包含 SKILL.md')
  }

  if (entry.file.size > MAX_SKILL_FILE_BYTES) {
    throw new Error('SKILL.md 过大，无法安装')
  }

  const entryMarkdown = await readFileAsText(entry.file)
  const packageFiles: SkillPackageFile[] = [
    {
      path: entry.path,
      content: entryMarkdown,
      size: entry.file.size
    }
  ]
  let totalBytes = entry.file.size

  for (const item of entries) {
    if (item.path === entry.path) continue
    if (!isTextFile(item.file, item.path)) continue
    if (item.file.size > MAX_SKILL_FILE_BYTES) continue
    if (totalBytes + item.file.size > MAX_SKILL_PACKAGE_BYTES) continue

    packageFiles.push({
      path: item.path,
      content: await readFileAsText(item.file),
      size: item.file.size
    })
    totalBytes += item.file.size
  }

  return {
    fileName: entry.path,
    markdown: entryMarkdown,
    source: 'folder',
    entryPath: entry.path,
    packageRoot: rawEntries[0]?.path.split('/')[0] || '',
    packageFiles
  }
}

export const SkillManager: React.FC = () => {
  const { skills, installSkill: onInstallSkill, removeSkill: onRemoveSkill } = useSettings()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [statusText, setStatusText] = useState('')
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    const inputs = [fileInputRef.current, folderInputRef.current].filter(
      (input): input is HTMLInputElement => !!input
    )
    if (inputs.length === 0) return

    const handleCancel = (): void => {
      window.api.setFilePickerActive(false)
      window.api.reSummonWindow()
    }

    inputs.forEach((input) => input.addEventListener('cancel', handleCancel))
    return () => {
      inputs.forEach((input) => input.removeEventListener('cancel', handleCancel))
    }
  }, [])

  const openFilePicker = (kind: 'file' | 'folder'): void => {
    setStatusText('')
    setErrorText('')
    window.api.setFilePickerActive(true)
    if (kind === 'folder') {
      folderInputRef.current?.click()
    } else {
      fileInputRef.current?.click()
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      window.api.setFilePickerActive(false)
      return
    }

    try {
      const markdown = await readFileAsText(file)
      const skill = await onInstallSkill({
        fileName: file.name,
        markdown,
        source: 'markdown'
      })
      setStatusText(`已安装 @${skill.trigger}`)
      setErrorText('')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      setErrorText(message)
      setStatusText('')
    } finally {
      window.api.setFilePickerActive(false)
    }
  }

  const handleFolderChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''

    if (files.length === 0) {
      window.api.setFilePickerActive(false)
      return
    }

    try {
      const payload = await readSkillFolderPayload(files)
      const skill = await onInstallSkill(payload)
      const fileCount = skill.packageFiles?.length || 1
      setStatusText(`已安装 @${skill.trigger}（${fileCount} 个文件）`)
      setErrorText('')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      setErrorText(message)
      setStatusText('')
    } finally {
      window.api.setFilePickerActive(false)
    }
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
          style={{
            fontSize: 'var(--font-size-base)',
            color: 'var(--color-text-title)',
            fontWeight: 'bold'
          }}
        >
          Skills
        </span>
        <div className="skill-install-actions">
          <button
            className="settings-save-btn skill-install-btn"
            onClick={() => openFilePicker('file')}
            title="安装 Markdown Skill"
          >
            <Upload size={12} />
            <span>Markdown</span>
          </button>
          <button
            className="settings-save-btn skill-install-btn"
            onClick={() => openFilePicker('folder')}
            title="安装 Skill 文件夹"
          >
            <FolderOpen size={12} />
            <span>文件夹</span>
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFolderChange}
        {...directoryInputProps}
      />

      {skills.length === 0 ? (
        <div className="skill-empty">暂无已安装 Skill</div>
      ) : (
        <div className="skill-list">
          {skills.map((skill) => {
            const triggers =
              skill.triggers && skill.triggers.length > 0 ? skill.triggers : [skill.trigger]
            const displayName = skill.interface?.displayName || skill.name
            const description = skill.interface?.shortDescription || skill.description
            return (
              <div key={skill.id} className="skill-card">
                <div className="skill-card-main">
                  <div className="skill-card-title-row">
                    <span className="skill-card-title">{displayName}</span>
                    <span className="skill-card-mode">{skill.mode || 'insert'}</span>
                    {skill.packageFiles && skill.packageFiles.length > 0 && (
                      <span className="skill-card-mode">{skill.packageFiles.length} files</span>
                    )}
                  </div>
                  <div className="skill-trigger-row">
                    {triggers.map((trigger) => (
                      <span key={trigger} className="skill-trigger-pill">
                        @{trigger}
                      </span>
                    ))}
                  </div>
                  {description && <div className="skill-description">{description}</div>}
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
