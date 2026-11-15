import { afterEach, describe, expect, it } from 'vitest'
import { bytesToHex, deriveHkdfBytes } from '~~/server/utils/hkdf'
import {
  deriveToolApprovalSecret,
  useToolApprovalSecret,
} from '~~/server/utils/tool-approval/secret'
import { TOOL_APPROVAL_SECRET_HKDF_INFO } from '#shared/utils/tool-approval-policy'
import { CONNECTOR_AUDIT_ARGS_HKDF_INFO } from '#shared/utils/connectors-policy'

describe('deriveToolApprovalSecret', () => {
  it('is deterministic for one encryption key', async () => {
    const first = await deriveToolApprovalSecret('encryption-key')
    const second = await deriveToolApprovalSecret('encryption-key')

    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for another encryption key', async () => {
    expect(await deriveToolApprovalSecret('key-one'))
      .not.toBe(await deriveToolApprovalSecret('key-two'))
  })

  it('uses the tool approval info string', async () => {
    expect(TOOL_APPROVAL_SECRET_HKDF_INFO).toBe('besidka/tool-approval/v1')
    expect(await deriveToolApprovalSecret('encryption-key')).toBe(
      bytesToHex(await deriveHkdfBytes(
        'encryption-key',
        TOOL_APPROVAL_SECRET_HKDF_INFO,
      )),
    )
  })

  it('is unrelated to the connector audit key', async () => {
    expect(await deriveToolApprovalSecret('encryption-key')).not.toBe(
      bytesToHex(await deriveHkdfBytes(
        'encryption-key',
        CONNECTOR_AUDIT_ARGS_HKDF_INFO,
      )),
    )
  })

  it('does not contain the encryption key', async () => {
    expect(await deriveToolApprovalSecret('encryption-key'))
      .not.toContain('encryption-key')
  })
})

describe('useToolApprovalSecret', () => {
  const config = useRuntimeConfig()
  const originalEncryptionKey = config.encryptionKey

  afterEach(() => {
    config.encryptionKey = originalEncryptionKey
  })

  it('derives from the runtime config and follows a key change', async () => {
    config.encryptionKey = 'key-one'

    const first = await useToolApprovalSecret()

    expect(first).toBe(await deriveToolApprovalSecret('key-one'))
    expect(await useToolApprovalSecret()).toBe(first)

    config.encryptionKey = 'key-two'

    expect(await useToolApprovalSecret())
      .toBe(await deriveToolApprovalSecret('key-two'))
  })

  it('refuses to run without an encryption key', async () => {
    config.encryptionKey = ''

    await expect(useToolApprovalSecret()).rejects.toMatchObject({
      status: 500,
    })
  })
})
