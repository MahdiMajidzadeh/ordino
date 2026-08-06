import { useState } from 'react'
import { usingMock } from '../api/client'
import {
  MOCK_FIXTURE_IDS,
  currentMockFixtureId,
  mockFailureEnabled,
  setMockFailure,
  setMockFixtureId
} from '../api/mock/mockOrdino'

/**
 * Dev-only fixture switcher (bottom-left). Only rendered when the renderer is
 * running against the mock API. Not localized on purpose — never ships.
 */
export function DevToolbar(): React.JSX.Element | null {
  const [fixture, setFixture] = useState(currentMockFixtureId)
  const [fail, setFail] = useState(mockFailureEnabled)

  if (!import.meta.env.DEV || !usingMock) return null

  return (
    <div className="fixed bottom-16 left-3 z-50 flex items-center gap-2 rounded-lg border border-line bg-surface-1/90 px-2.5 py-1.5 text-xs text-ink-secondary opacity-60 shadow-sm backdrop-blur transition-opacity hover:opacity-100">
      <span className="font-semibold text-ink-faint">mock</span>
      <select
        value={fixture}
        onChange={(e) => {
          setMockFixtureId(e.target.value)
          setFixture(e.target.value)
          location.reload()
        }}
        className="rounded border border-line bg-surface-2 px-1 py-0.5"
      >
        {MOCK_FIXTURE_IDS.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={fail}
          onChange={(e) => {
            setMockFailure(e.target.checked)
            setFail(e.target.checked)
          }}
        />
        fail
      </label>
    </div>
  )
}
