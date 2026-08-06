import { describe, expect, it } from 'vitest'
import { parseProxyResolution } from '@main/util/proxy-parse'

describe('parseProxyResolution', () => {
  it('parses PROXY and HTTPS entries', () => {
    expect(parseProxyResolution('PROXY 127.0.0.1:10808')).toBe('http://127.0.0.1:10808')
    expect(parseProxyResolution('HTTPS proxy.corp:8443')).toBe('https://proxy.corp:8443')
  })

  it('returns null for DIRECT', () => {
    expect(parseProxyResolution('DIRECT')).toBeNull()
  })

  it('skips SOCKS entries and honors the next usable one', () => {
    expect(parseProxyResolution('SOCKS5 127.0.0.1:1080; PROXY 127.0.0.1:10808')).toBe(
      'http://127.0.0.1:10808'
    )
    expect(parseProxyResolution('SOCKS5 127.0.0.1:1080; DIRECT')).toBeNull()
    expect(parseProxyResolution('SOCKS5 127.0.0.1:1080')).toBeNull()
  })

  it('takes the first usable entry from a fallback list', () => {
    expect(parseProxyResolution('PROXY a:1; PROXY b:2; DIRECT')).toBe('http://a:1')
    expect(parseProxyResolution('DIRECT; PROXY a:1')).toBeNull()
  })
})
