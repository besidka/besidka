import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_CONSENT_TEXT_SHA256,
  CONNECTOR_CONSENT_VERSION,
} from '#shared/utils/connectors-policy'

const CONSENT_PATH = 'app/components/Profile/Connectors/ConsentText.vue'

function readConsentWording(): string[] {
  const source = readFileSync(join(process.cwd(), CONSENT_PATH), 'utf-8')
  const spans = source.matchAll(
    /<span[^>]*\bdata-connector-consent-text\b[^>]*>([\s\S]*?)<\/span>/g,
  )

  return [...spans].map((match) => {
    return (match[1] ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  })
}

function hashWording(wording: string[]): string {
  return createHash('sha256').update(wording.join('\n')).digest('hex')
}

describe('connector consent wording and version', () => {
  it('finds the transfer, sensitive-data and withdrawal parts', () => {
    const wording = readConsentWording().join('\n')

    expect(wording).toContain('outside the European Economic Area')
    expect(wording).toContain('no contract with this server')
    expect(wording).toContain('anything from the chat')
    expect(wording).toContain('other people\'s data')
    expect(wording).toContain('withdraw this consent')
    expect(wording).toContain('I explicitly consent')
    expect(wording).toContain('sensitive data')
  })

  it('pins the wording to the connector consent version', () => {
    const actualHash = hashWording(readConsentWording())

    expect(
      actualHash,
      `The connector consent wording in ${CONSENT_PATH} changed. If the `
      + 'change alters what users agree to, bump CONNECTOR_CONSENT_VERSION '
      + `(now ${CONNECTOR_CONSENT_VERSION}) so every connector asks again; `
      + `either way set CONNECTOR_CONSENT_TEXT_SHA256 to ${actualHash}.`,
    ).toBe(CONNECTOR_CONSENT_TEXT_SHA256)
  })
})
