import { describe, expect, it } from 'vitest'
import { getLoginShellEnv, parseEnvNul } from '@main/util/shell-env'

describe('parseEnvNul', () => {
  it('parses NUL-separated env including values with newlines and equals', () => {
    const parsed = parseEnvNul('A=1\0MULTI=line1\nline2\0EQ=a=b=c\0\0BAD\0')
    expect(parsed).toEqual({ A: '1', MULTI: 'line1\nline2', EQ: 'a=b=c' })
  })
})

describe('getLoginShellEnv', () => {
  it('captures a login shell env with PATH on this machine', async () => {
    const env = await getLoginShellEnv()
    if (process.platform === 'win32') {
      expect(env).toEqual({})
      return
    }
    expect(env.PATH).toBeTruthy()
    expect(env.HOME).toBeTruthy()
  })
})
