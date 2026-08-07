import { describe, expect, it } from 'vitest'
import { captureStdout, getLoginShellEnv, parseEnvNul } from '@main/util/shell-env'

describe('parseEnvNul', () => {
  it('parses NUL-separated env including values with newlines and equals', () => {
    const parsed = parseEnvNul('A=1\0MULTI=line1\nline2\0EQ=a=b=c\0\0BAD\0')
    expect(parsed).toEqual({ A: '1', MULTI: 'line1\nline2', EQ: 'a=b=c' })
  })
})

describe('captureStdout', () => {
  it('returns stdout of a well-behaved command', async () => {
    expect((await captureStdout('echo', ['hello'], 5000)).trim()).toBe('hello')
  })

  it('resolves empty rather than throwing when the command does not exist', async () => {
    expect(await captureStdout('definitely-not-a-real-binary-xyz', [], 2000)).toBe('')
  })

  it('gives up on a hanging command instead of waiting forever', async () => {
    // `sleep` never writes and never exits within the bound — the exact shape
    // that hung startup for fifteen minutes before the timer existed.
    const started = Date.now()
    const out = await captureStdout('sleep', ['30'], 400)
    const elapsed = Date.now() - started
    expect(out).toBe('')
    expect(elapsed).toBeLessThan(3000)
  })

  it('is not blocked by a child that waits on stdin', async () => {
    const started = Date.now()
    await captureStdout('cat', [], 1000) // stdin is closed, so cat exits at once
    expect(Date.now() - started).toBeLessThan(3000)
  })
})

describe('getLoginShellEnv', () => {
  it('captures a login shell env within a bounded time', async () => {
    const started = Date.now()
    const env = await getLoginShellEnv()
    // Two bounded attempts worst case; must never approach a startup stall.
    expect(Date.now() - started).toBeLessThan(12_000)
    if (process.platform === 'win32') {
      expect(env).toEqual({})
      return
    }
    expect(typeof env).toBe('object')
  }, 20_000)
})
