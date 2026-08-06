import type { StateCreator } from 'zustand'
import type { ClaudeDetection, GlobalSettings } from '@shared/types'
import { ordino } from '../api/client'
import type { AppState } from './index'

export interface SettingsSlice {
  settings: GlobalSettings | null
  claudeDetection: ClaudeDetection | null
  loadSettings: () => Promise<void>
  patchSettings: (patch: Partial<GlobalSettings>) => Promise<void>
  detectClaude: () => Promise<void>
}

export const createSettingsSlice: StateCreator<AppState, [], [], SettingsSlice> = (set, get) => ({
  settings: null,
  claudeDetection: null,

  loadSettings: async () => {
    const res = await ordino.invoke('settings:get', undefined)
    if (res.ok) {
      set({ settings: res.data })
      // Hydrate the strategy default from the last run (P1-4) only while the
      // wizard is still on home — never stomp an in-flight session.
      if (get().screen === 'home' && res.data.lastStrategy) {
        get().setStrategy(res.data.lastStrategy)
      }
    }
  },

  patchSettings: async (patch) => {
    const res = await ordino.invoke('settings:set', patch)
    if (res.ok) set({ settings: res.data })
  },

  detectClaude: async () => {
    const res = await ordino.invoke('provider:detectClaude', undefined)
    if (res.ok) set({ claudeDetection: res.data })
    else set({ claudeDetection: { installed: false } })
  }
})
