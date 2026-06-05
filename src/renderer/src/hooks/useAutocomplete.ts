import React, { useState, useEffect, useRef } from 'react'
import { Skill, AutocompleteItem, Session, ApiProvider } from '../../../shared/types'

export interface UseAutocompleteReturn {
  skills: Skill[]
  setSkills: React.Dispatch<React.SetStateAction<Skill[]>>
  autocompleteItems: AutocompleteItem[]
  setAutocompleteItems: React.Dispatch<React.SetStateAction<AutocompleteItem[]>>
  selectedItemIdx: number
  setSelectedItemIdx: React.Dispatch<React.SetStateAction<number>>
  skillsMenuRef: React.RefObject<HTMLDivElement | null>
  updateAutocompleteItems: (
    val: string,
    modelsList: string[],
    sessions: Session[],
    activeSessionId: string,
    providers: ApiProvider[]
  ) => void
  handleInputKeyDown: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    triggerAutocompleteItem: (item: AutocompleteItem) => void | Promise<void>
  ) => boolean
}

export const useAutocomplete = (): UseAutocompleteReturn => {
  const [skills, setSkills] = useState<Skill[]>([])
  const [autocompleteItems, setAutocompleteItems] = useState<AutocompleteItem[]>([])
  const [selectedItemIdx, setSelectedItemIdx] = useState(0)
  const skillsMenuRef = useRef<HTMLDivElement>(null)

  // Load skills on startup
  useEffect(() => {
    const loadSkills = async (): Promise<void> => {
      const savedSkills = (await window.api.storeGet('skills') as Skill[]) || []
      setSkills(savedSkills)
    }
    loadSkills()
  }, [])

  // Scroll selected autocomplete item into view
  useEffect(() => {
    if (autocompleteItems.length > 0 && skillsMenuRef.current) {
      const container = skillsMenuRef.current
      const selectedElement = container.children[selectedItemIdx] as HTMLElement
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedItemIdx, autocompleteItems])

  const updateAutocompleteItems = (
    val: string,
    modelsList: string[],
    sessions: Session[],
    activeSessionId: string,
    providers: ApiProvider[]
  ): void => {
    if (val.startsWith('/')) {
      const search = val.slice(1).toLowerCase()

      // 1. Built-in System Commands
      const systemCommands: AutocompleteItem[] = [
        { id: 'cmd-new', name: '🆕 新建对话 (Start new chat)', trigger: '/new', cmd: 'new', type: 'command' },
        { id: 'cmd-clear', name: '🧹 清空当前对话 (Clear current chat)', trigger: '/clear', cmd: 'clear', type: 'command' },
        { id: 'cmd-settings', name: '⚙️ 打开应用设置 (Open settings)', trigger: '/settings', cmd: 'settings', type: 'command' },
        { id: 'cmd-help', name: 'ℹ️ 显示快捷指令帮助 (Show help)', trigger: '/help', cmd: 'help', type: 'command' },
        { id: 'cmd-exit', name: '❌ 隐藏/关闭窗口 (Hide window)', trigger: '/exit', cmd: 'exit', type: 'command' }
      ]
      const matchingCmds: AutocompleteItem[] = systemCommands.filter((c) =>
        c.trigger.toLowerCase().startsWith(val.toLowerCase())
      )

      // 2. Predefined Skills
      const matchingSkills: AutocompleteItem[] = skills
        .filter((s) => `/${s.trigger}`.toLowerCase().startsWith(val.toLowerCase()) || s.name.toLowerCase().includes(search))
        .map((s) => ({
          id: s.id,
          name: s.name,
          trigger: `/${s.trigger}`,
          prompt: s.prompt,
          type: 'skill'
        }))

      // 3. Models switching command options
      const matchingModels: AutocompleteItem[] = modelsList
        .filter((m) => `/model:${m}`.toLowerCase().includes(val.toLowerCase()) || m.toLowerCase().includes(search))
        .map((m) => ({
          id: `model-${m}`,
          name: `🔄 使用大模型 ${m}`,
          trigger: `/model:${m}`,
          modelId: m,
          type: 'model'
        }))

      // 4. Session histories (exclude active one and empty ones)
      const matchingSessions: AutocompleteItem[] = sessions
        .filter((s) => s.id !== activeSessionId && s.messages.length > 0)
        .filter((s) => s.title.toLowerCase().includes(search) || 'history'.includes(search))
        .map((s) => ({
          id: s.id,
          name: s.title,
          trigger: `/history:${s.id}`,
          prompt: '',
          type: 'session'
        }))

      // 5. Session deletion options
      const matchingDeleteSessions: AutocompleteItem[] = sessions
        .filter((s) => s.messages.length > 0)
        .filter((s) => `/delete:${s.id}`.toLowerCase().includes(val.toLowerCase()) || s.title.toLowerCase().includes(search) || 'delete'.includes(search) || 'del'.includes(search))
        .map((s) => ({
          id: `delete-${s.id}`,
          name: `删除会话: ${s.title}`,
          trigger: `/delete:${s.id}`,
          sessionId: s.id,
          type: 'delete-session'
        }))

      // 6. Provider switching options
      const matchingProviders: AutocompleteItem[] = providers
        .filter((p) => `/provider:${p.name}`.toLowerCase().includes(val.toLowerCase()) || p.name.toLowerCase().includes(search) || 'provider'.includes(search) || 'p'.includes(search))
        .map((p) => ({
          id: `provider-${p.id}`,
          name: `切换服务商: ${p.name} (${p.apiUrl})`,
          trigger: `/provider:${p.id}`,
          providerId: p.id,
          type: 'provider'
        }))

      const combined: AutocompleteItem[] = [
        ...matchingCmds,
        ...matchingSkills,
        ...matchingModels,
        ...matchingSessions,
        ...matchingDeleteSessions,
        ...matchingProviders
      ]
      setAutocompleteItems(combined)
      setSelectedItemIdx((prev) => {
        if (combined.length === 0) return 0
        if (prev < 0 || prev >= combined.length) return 0
        return prev
      })
    } else {
      setAutocompleteItems([])
    }
  }

  const handleInputKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    triggerAutocompleteItem: (item: AutocompleteItem) => void | Promise<void>
  ): boolean => {
    if (autocompleteItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedItemIdx((prev) => (prev + 1) % autocompleteItems.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedItemIdx((prev) => (prev - 1 + autocompleteItems.length) % autocompleteItems.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const promiseOrVoid = triggerAutocompleteItem(autocompleteItems[selectedItemIdx])
        if (promiseOrVoid instanceof Promise) {
          promiseOrVoid.catch(console.error)
        }
        return true
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setAutocompleteItems([])
        return true
      }
    }
    return false
  }

  return {
    skills,
    setSkills,
    autocompleteItems,
    setAutocompleteItems,
    selectedItemIdx,
    setSelectedItemIdx,
    skillsMenuRef,
    updateAutocompleteItems,
    handleInputKeyDown
  }
}
