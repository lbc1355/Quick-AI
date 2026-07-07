import React, { createContext, useContext } from 'react'
import { useProviders, UseProvidersReturn } from '../hooks/useProviders'
import { useSkills, UseSkillsReturn } from '../hooks/useSkills'

/**
 * Single source of truth for all persisted settings state (providers, models, API keys, agent
 * permissions, skills). Owning these hooks here lets the settings UI consume them via `useSettings`
 * instead of receiving ~60 drilled props from `App`, which also keeps `App` and `SettingsView`
 * reading the exact same hook instance.
 */
export type SettingsContextValue = UseProvidersReturn & UseSkillsReturn

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const providers = useProviders()
  const skills = useSkills()
  const value: SettingsContextValue = { ...providers, ...skills }
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
