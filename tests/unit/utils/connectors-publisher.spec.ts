import { describe, expect, it } from 'vitest'
import { deriveConnectorPublisher } from '#shared/utils/connectors-publisher'

describe('deriveConnectorPublisher', () => {
  it.each([
    ['app.linear/linear', 'linear.app'],
    ['xyz.linear/linear', 'linear.xyz'],
    ['ai.exa/exa', 'exa.ai'],
    ['com.notion/mcp', 'notion.com'],
    ['com.google.maps/server', 'maps.google.com'],
    ['COM.Google/Server', 'google.com'],
    ['io.github.acme/tool', 'github.com/acme'],
    ['com.github.acme-inc/tool', 'github.com/acme-inc'],
    ['io.gitlab.someone/tool', 'gitlab.com/someone'],
    ['io.github/tool', 'github.io'],
  ])('reads %s as %s', (name, publisher) => {
    expect(deriveConnectorPublisher(name)).toBe(publisher)
  })

  it('keeps two publishers with the same name apart', () => {
    expect(deriveConnectorPublisher('app.linear/a'))
      .not.toBe(deriveConnectorPublisher('xyz.linear/a'))
  })

  it.each([
    ['no namespace', 'tool'],
    ['one label', 'linear/tool'],
    ['empty', ''],
    ['markup in the namespace', 'io.<b>x</b>/tool'],
    ['an overlong label', `io.${'a'.repeat(41)}/tool`],
    ['an overlong domain', `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}.${'d'.repeat(30)}/tool`],
  ])('gives nothing for %s', (_label, name) => {
    expect(deriveConnectorPublisher(name)).toBeNull()
  })
})
