import { describe, expect, it, vi } from 'vitest'
import {
  auditConnectorCall,
  createConnectorArgsHasher,
} from '~~/server/utils/connectors/audit'

describe('connector audit', () => {
  it('derives a stable keyed digest that ignores key order', async () => {
    const hash = createConnectorArgsHasher('secret-one')
    const first = await hash({ b: 1, a: 'x' })

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(await hash({ a: 'x', b: 1 })).toBe(first)
    expect(await hash({ a: 'x', b: 2 })).not.toBe(first)
  })

  it('depends on the secret, so a plain hash guess does not confirm '
    + 'the arguments', async () => {
    const args = { query: 'short' }
    const plain = Array.from(new Uint8Array(await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(args)),
    ))).map(byte => byte.toString(16).padStart(2, '0')).join('')

    expect(await createConnectorArgsHasher('a')(args))
      .not.toBe(await createConnectorArgsHasher('b')(args))
    expect(await createConnectorArgsHasher('a')(args)).not.toBe(plain)
  })

  it('treats missing arguments as an empty object', async () => {
    const hash = createConnectorArgsHasher('secret-one')

    expect(await hash(undefined)).toBe(await hash({}))
  })

  it('logs by id and never throws when the write fails', async () => {
    const logger = { set: vi.fn() }
    const failingDb = {
      insert: () => {
        throw new Error('D1 down with a secret detail')
      },
    }

    await expect(auditConnectorCall(
      failingDb as never,
      createConnectorArgsHasher('secret-one'),
      {
        userId: 1,
        connectorId: 'c1',
        connectorHost: 'mcp.example.com',
        chatPublicId: 'chat1',
        toolName: 'list',
        args: {},
        resultBytes: 0,
        outcome: 'error',
        approval: 'not-applicable',
        durationMs: 1,
      },
      logger,
    )).resolves.toBeNull()
    expect(JSON.stringify(logger.set.mock.calls)).not.toContain('secret detail')
    expect(logger.set).toHaveBeenCalledWith({
      attributes: { connectors: { id: 'c1', auditWrite: 'failed' } },
    })
  })
})
