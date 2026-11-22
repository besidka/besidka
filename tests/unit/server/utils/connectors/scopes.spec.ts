import { describe, expect, it } from 'vitest'
import {
  compareGrantedScope,
  degradedScopeNote,
} from '~~/server/utils/connectors/scopes'

describe('compareGrantedScope', () => {
  it('treats an omitted scope as the requested one', () => {
    expect(compareGrantedScope('read write', null))
      .toEqual({ grantedScope: 'read write', degraded: false })
  })

  it('accepts the same scopes in another order and extra scopes', () => {
    expect(compareGrantedScope('read write', 'write read admin'))
      .toEqual({ grantedScope: 'write read admin', degraded: false })
  })

  it('flags a narrower grant', () => {
    expect(compareGrantedScope('read write', 'read'))
      .toEqual({ grantedScope: 'read', degraded: true })
  })

  it('flags an empty grant', () => {
    expect(compareGrantedScope('read', ''))
      .toEqual({ grantedScope: null, degraded: true })
  })

  it('stores whatever was granted when nothing was requested', () => {
    expect(compareGrantedScope(null, 'read'))
      .toEqual({ grantedScope: 'read', degraded: false })
  })

  it('writes a fixed note without scope names', () => {
    const note = degradedScopeNote()

    expect(note.code).toBe('CONNECTOR_SCOPE_DEGRADED')
    expect(note.degraded).toBeTruthy()
  })
})
