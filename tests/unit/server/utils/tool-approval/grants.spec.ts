import { describe, expect, it, vi } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import {
  isDecodableConnectorId,
  revokeAlwaysToolApprovalGrant,
} from '~~/server/utils/tool-approval/grants'

describe('isDecodableConnectorId', () => {
  it('accepts an id the real codec produced', () => {
    expect(isDecodableConnectorId(encodePublicId(42))).toBe(true)
  })

  it.each(['zz', 'missing', '0', 'A'])('rejects %s', (connectorId) => {
    expect(isDecodableConnectorId(connectorId)).toBe(false)
  })
})

describe('revokeAlwaysToolApprovalGrant', () => {
  it('changes nothing and touches no table for an undecodable id',
    async () => {
      const db = {
        select: vi.fn(() => {
          throw new Error('The database must not be read')
        }),
        update: vi.fn(() => {
          throw new Error('The database must not be written')
        }),
      }

      await expect(revokeAlwaysToolApprovalGrant(db as never, 1, {
        connectorId: 'missing',
        toolName: 'create_issue',
      })).resolves.toBe(false)
      expect(db.select).not.toHaveBeenCalled()
      expect(db.update).not.toHaveBeenCalled()
    })
})
