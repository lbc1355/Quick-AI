import React, { useState, useEffect, useRef } from 'react'
import { Skill, AutocompleteItem, Session, ApiProvider } from '../../../shared/types'

export interface UseAutocompleteReturn {
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
    providers: ApiProvider[],
    skills: Skill[]
  ) => void
  handleInputKeyDown: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    triggerAutocompleteItem: (item: AutocompleteItem) => void | Promise<void>,
    onTabComplete?: (item: AutocompleteItem) => void
  ) => boolean
}

export const useAutocomplete = (): UseAutocompleteReturn => {
  const [autocompleteItems, setAutocompleteItems] = useState<AutocompleteItem[]>([])
  const [selectedItemIdx, setSelectedItemIdx] = useState(0)
  const skillsMenuRef = useRef<HTMLDivElement>(null)

  // Scroll selected autocomplete item into view
  useEffect(() => {
    if (autocompleteItems.length > 0 && skillsMenuRef.current) {
      const container = skillsMenuRef.current
      const selectedElement = container.querySelector<HTMLElement>(
        `[data-autocomplete-index="${selectedItemIdx}"]`
      )
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
    providers: ApiProvider[],
    skills: Skill[]
  ): void => {
    if (val.startsWith('@')) {
      const skillSearch = val.slice(1).trimStart().split(/\s+/)[0].toLowerCase()
      const skillPrefix = `@${skillSearch}`
      const search = skillSearch

      const matchingSkills: AutocompleteItem[] = skills
        .map((skill) => {
          const triggers =
            skill.triggers && skill.triggers.length > 0 ? skill.triggers : [skill.trigger]
          const matchingTrigger = triggers.find((trigger) =>
            `@${trigger}`.toLowerCase().startsWith(skillPrefix)
          )
          const displayName = skill.interface?.displayName || skill.name
          const description = skill.interface?.shortDescription || skill.description || ''
          return { skill, triggers, matchingTrigger, displayName, description }
        })
        .filter(
          ({ skill, matchingTrigger, displayName, description }) =>
            Boolean(matchingTrigger) ||
            skill.name.toLowerCase().includes(search) ||
            displayName.toLowerCase().includes(search) ||
            description.toLowerCase().includes(search)
        )
        .map(({ skill, matchingTrigger, displayName, description }) => ({
          id: skill.id,
          name: description ? `${displayName} - ${description}` : displayName,
          trigger: `@${matchingTrigger || skill.trigger}`,
          prompt: skill.prompt,
          skillId: skill.id,
          skillMode: skill.mode || 'insert',
          type: 'skill'
        }))

      setAutocompleteItems(matchingSkills)
      setSelectedItemIdx((prev) => {
        if (matchingSkills.length === 0) return 0
        if (prev < 0 || prev >= matchingSkills.length) return 0
        return prev
      })
    } else if (val.startsWith('/')) {
      const commandSearch = val.slice(1).trimStart().split(/\s+/)[0].toLowerCase()
      const commandPrefix = `/${commandSearch}`
      const search = commandSearch

      // 1. Built-in System Commands
      const systemCommands: AutocompleteItem[] = [
        {
          id: 'cmd-new',
          name: '🆕 新建对话 (Start new chat)',
          trigger: '/new',
          cmd: 'new',
          type: 'command'
        },
        {
          id: 'cmd-clear',
          name: '🧹 清空当前对话 (Clear current chat)',
          trigger: '/clear',
          cmd: 'clear',
          type: 'command'
        },
        {
          id: 'cmd-settings',
          name: '⚙️ 打开应用设置 (Open settings)',
          trigger: '/settings',
          cmd: 'settings',
          type: 'command'
        },
        {
          id: 'cmd-help',
          name: 'ℹ️ 显示快捷指令帮助 (Show help)',
          trigger: '/help',
          cmd: 'help',
          type: 'command'
        },
        {
          id: 'cmd-compact',
          name: '压缩当前上下文 (Compact context)',
          trigger: '/compact',
          cmd: 'compact',
          type: 'command'
        },
        {
          id: 'cmd-exit',
          name: '❌ 隐藏/关闭窗口 (Hide window)',
          trigger: '/exit',
          cmd: 'exit',
          type: 'command'
        }
      ]
      const matchingCmds: AutocompleteItem[] = systemCommands.filter((c) =>
        c.trigger.toLowerCase().startsWith(commandPrefix)
      )

      // 2. Models switching command options
      const matchingModels: AutocompleteItem[] = modelsList
        .filter(
          (m) =>
            `/model:${m}`.toLowerCase().includes(commandPrefix) || m.toLowerCase().includes(search)
        )
        .map((m) => ({
          id: `model-${m}`,
          name: `🔄 使用大模型 ${m}`,
          trigger: `/model:${m}`,
          modelId: m,
          type: 'model'
        }))

      // 3. Session histories (exclude active one and empty ones)
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

      // 4. Session deletion options
      const matchingDeleteSessions: AutocompleteItem[] = sessions
        .filter((s) => s.messages.length > 0)
        .filter(
          (s) =>
            `/delete:${s.id}`.toLowerCase().includes(commandPrefix) ||
            s.title.toLowerCase().includes(search) ||
            'delete'.includes(search) ||
            'del'.includes(search)
        )
        .map((s) => ({
          id: `delete-${s.id}`,
          name: `删除会话: ${s.title}`,
          trigger: `/delete:${s.id}`,
          sessionId: s.id,
          type: 'delete-session'
        }))

      // 5. Provider switching options
      const matchingProviders: AutocompleteItem[] = providers
        .filter(
          (p) =>
            `/provider:${p.name}`.toLowerCase().includes(commandPrefix) ||
            p.name.toLowerCase().includes(search) ||
            'provider'.includes(search) ||
            'p'.includes(search)
        )
        .map((p) => ({
          id: `provider-${p.id}`,
          name: `切换服务商: ${p.name} (${p.apiUrl})`,
          trigger: `/provider:${p.id}`,
          providerId: p.id,
          type: 'provider'
        }))

      const combined: AutocompleteItem[] = [
        ...matchingCmds,
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
      setAutocompleteItems((prev) => (prev.length === 0 ? prev : []))
    }
  }

  const handleInputKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    triggerAutocompleteItem: (item: AutocompleteItem) => void | Promise<void>,
    onTabComplete?: (item: AutocompleteItem) => void
  ): boolean => {
    if (autocompleteItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedItemIdx((prev) => (prev + 1) % autocompleteItems.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedItemIdx(
          (prev) => (prev - 1 + autocompleteItems.length) % autocompleteItems.length
        )
        return true
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        if (onTabComplete) {
          onTabComplete(autocompleteItems[selectedItemIdx])
        } else {
          const promiseOrVoid = triggerAutocompleteItem(autocompleteItems[selectedItemIdx])
          if (promiseOrVoid instanceof Promise) {
            promiseOrVoid.catch(console.error)
          }
        }
        return true
      }
      if (e.key === 'Enter') {
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
    autocompleteItems,
    setAutocompleteItems,
    selectedItemIdx,
    setSelectedItemIdx,
    skillsMenuRef,
    updateAutocompleteItems,
    handleInputKeyDown
  }
}
