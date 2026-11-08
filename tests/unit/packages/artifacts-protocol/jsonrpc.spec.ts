import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_KINDS,
  ERROR_CODES,
  RpcError,
  createConnectMessage,
  isArtifactKind,
  isCompleteParams,
  isConnectMessage,
  isHostContext,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  isJsonValue,
  isLogMessageParams,
  isOpenLinkParams,
  isSizeChangedParams,
  isStorageSetParams,
  isToolResultParams,
  measureJsonValue,
  normalizeLinkUrl,
  toRpcError,
} from '@besidka/artifacts-protocol'

describe('artifacts protocol envelopes', () => {
  it('recognises requests, notifications and responses', () => {
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'ui/initialize' }))
      .toBe(true)
    expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'ui/initialize' }))
      .toBe(false)
    expect(isJsonRpcNotification({ jsonrpc: '2.0', method: 'x', params: {} }))
      .toBe(true)
    expect(isJsonRpcNotification({ jsonrpc: '2.0', id: 1, method: 'x' }))
      .toBe(false)
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, result: {} }))
      .toBe(true)
    expect(isJsonRpcResponse({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'Method not found' },
    })).toBe(true)
  })

  it('rejects malformed envelopes', () => {
    expect(isJsonRpcRequest({ jsonrpc: '1.0', id: 1, method: 'x' })).toBe(false)
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: {}, method: 'x' })).toBe(false)
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: '' })).toBe(false)
    expect(isJsonRpcRequest(null)).toBe(false)
    expect(isJsonRpcResponse({
      jsonrpc: '2.0',
      id: 1,
      result: {},
      error: { code: 1, message: 'both' },
    })).toBe(false)
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1 })).toBe(false)
    expect(isJsonRpcResponse({
      jsonrpc: '2.0',
      id: 1,
      error: { code: 1.5, message: 'fractional' },
    })).toBe(false)
  })

  it('accepts only a connect message for protocol version 1', () => {
    expect(isConnectMessage(createConnectMessage())).toBe(true)
    expect(isConnectMessage({ type: 'besidka/connect', protocol: 2 }))
      .toBe(false)
    expect(isConnectMessage({ type: 'other', protocol: 1 })).toBe(false)
  })

  it('maps unknown exceptions to a generic internal error', () => {
    const rpcError = new RpcError(ERROR_CODES.consentRequired, 'Consent')

    expect(toRpcError(rpcError)).toBe(rpcError)
    expect(toRpcError(new Error('secret detail')).toJSON()).toEqual({
      code: ERROR_CODES.internalError,
      message: 'Internal error',
    })
  })
})

describe('artifacts protocol params guards', () => {
  it('lists the five artifact kinds', () => {
    expect([...ARTIFACT_KINDS])
      .toEqual(['html', 'react', 'svg', 'mermaid', 'markdown'])
    expect(isArtifactKind('react')).toBe(true)
    expect(isArtifactKind('python')).toBe(false)
  })

  it('validates host context and tool results', () => {
    expect(isHostContext({
      theme: 'dark',
      displayMode: 'panel',
      locale: 'en',
      capabilities: { storage: 'memory', complete: false },
    })).toBe(true)
    expect(isHostContext({
      theme: 'blue',
      displayMode: 'panel',
      locale: 'en',
      capabilities: { storage: 'memory', complete: false },
    })).toBe(false)
    expect(isToolResultParams({
      structuredContent: {
        kind: 'html',
        title: 'Quiz',
        content: '<p>Hi</p>',
        artifactId: 'abc',
        version: 2,
      },
    })).toBe(true)
    expect(isToolResultParams({
      structuredContent: {
        kind: 'html',
        title: 'Quiz',
        content: '<p>Hi</p>',
        version: 1.5,
      },
    })).toBe(false)
  })

  it('validates untrusted runtime params', () => {
    expect(isSizeChangedParams({ height: 120 })).toBe(true)
    expect(isSizeChangedParams({ height: -1 })).toBe(false)
    expect(isSizeChangedParams({ height: Number.POSITIVE_INFINITY }))
      .toBe(false)
    expect(isOpenLinkParams({ url: 'https://example.com/a' })).toBe(true)
    expect(isOpenLinkParams({ url: 'javascript:alert(1)' })).toBe(false)
    expect(isOpenLinkParams({ url: `https://example.com/${'a'.repeat(3000)}` }))
      .toBe(false)
    expect(isLogMessageParams({ level: 'error', data: { message: 'x' } }))
      .toBe(true)
    expect(isLogMessageParams({ level: 'info', data: { message: 'x' } }))
      .toBe(false)
    expect(isCompleteParams({ prompt: 'Hello', maxOutputTokens: 100 }))
      .toBe(true)
    expect(isCompleteParams({ prompt: '' })).toBe(false)
    expect(isCompleteParams({ prompt: 'x'.repeat(8_001) })).toBe(false)
  })

  it('bounds sizes, tokens, keys and links', () => {
    expect(isSizeChangedParams({ height: 100_001 })).toBe(false)
    expect(isCompleteParams({ prompt: 'Hi', maxOutputTokens: 2_001 }))
      .toBe(false)
    expect(isStorageSetParams({ key: '__proto__', value: 1 })).toBe(false)
    expect(isStorageSetParams({ key: 'a\u0000b', value: 1 })).toBe(false)
    expect(isStorageSetParams({ key: 'quiz:answers', value: 'x'.repeat(100_001) }))
      .toBe(false)
    expect(normalizeLinkUrl('https://besidka.com@evil.example/')).toBeNull()
    expect(normalizeLinkUrl('https://example.com/‮gnp.exe')).toBeNull()
    expect(normalizeLinkUrl('https://EXAMPLE.com/a b')).toBe(
      'https://example.com/a%20b',
    )
  })

  it('validates shared-reference graphs in linear time', () => {
    let value: unknown[] = []

    for (let index = 0; index < 31; index += 1) {
      value = [value, value]
    }

    const startedAt = performance.now()

    expect(isJsonValue(value)).toBe(false)
    expect(performance.now() - startedAt).toBeLessThan(100)
    expect(measureJsonValue({ list: new Array(20_000).fill(1) })).toBeNull()
    expect(measureJsonValue({ a: [1, 'two', null] })).toBeGreaterThan(0)
  })

  it('accepts only plain JSON values for storage', () => {
    expect(isStorageSetParams({ key: 'score', value: { answers: [1, 2] } }))
      .toBe(true)
    expect(isStorageSetParams({ key: '', value: 1 })).toBe(false)
    expect(isJsonValue(Number.NaN)).toBe(false)
    expect(isJsonValue(new Date())).toBe(false)
    expect(isJsonValue({ nested: { deeper: [null, true, 'x'] } })).toBe(true)
  })
})
