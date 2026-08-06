import type { StateCreator } from 'zustand'
import type { AppState } from './index'

export type Screen = 'home' | 'scan' | 'strategy' | 'analyzing' | 'review' | 'applying' | 'done'
export type Overlay = 'settings' | 'history' | null

/** Wizard step indicator mapping (§8): 4 steps over 7 screens. */
export const STEP_OF_SCREEN: Record<Screen, number> = {
  home: 0,
  scan: 0,
  strategy: 1,
  analyzing: 2,
  review: 2,
  applying: 3,
  done: 3
}

export interface WizardSlice {
  screen: Screen
  overlay: Overlay
  goTo: (screen: Screen) => void
  openOverlay: (overlay: Exclude<Overlay, null>) => void
  closeOverlay: () => void
  /** Full reset for "Organize another folder". */
  resetWizard: () => void
}

export const createWizardSlice: StateCreator<AppState, [], [], WizardSlice> = (set) => ({
  screen: 'home',
  overlay: null,
  goTo: (screen) => set({ screen }),
  openOverlay: (overlay) => set({ overlay }),
  closeOverlay: () => set({ overlay: null }),
  resetWizard: () =>
    set({
      screen: 'home',
      overlay: null
    })
})
