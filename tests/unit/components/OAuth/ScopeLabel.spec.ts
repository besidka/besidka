import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { MCP_OAUTH_SCOPES } from '#shared/utils/mcp-oauth-scopes'
import ScopeLabel from '../../../../app/components/OAuth/ScopeLabel.vue'

const ARTIFACT_LABELS = {
  'artifacts:read': 'Read your artifacts and their share links',
  'artifacts:write': 'Create and edit your artifacts',
  'artifacts:share': 'Publish artifacts as public links (up to 30 days)',
} as const

describe('OAuth scope label', () => {
  it('names the artifact scopes in words', async () => {
    for (const [scope, title] of Object.entries(ARTIFACT_LABELS)) {
      const wrapper = await mountSuspended(ScopeLabel, { props: { scope } })

      expect(wrapper.text(), scope).toBe(title)
    }
  })

  it('names the connector scopes and says what they cannot do', async () => {
    const read = await mountSuspended(ScopeLabel, {
      props: { scope: 'connectors:read', withDescription: true },
    })
    const write = await mountSuspended(ScopeLabel, {
      props: { scope: 'connectors:write', withDescription: true },
    })

    expect(read.text()).toContain(
      'See your connectors: names and addresses, never their keys',
    )
    expect(read.text()).toContain('Never their keys or sign-in tokens')
    expect(write.text()).toContain(
      'Add, change and delete connectors. New ones start switched off; '
      + 'you switch them on in Besidka',
    )
    expect(write.text()).toContain('It cannot switch a connector on')
    expect(write.text()).toContain('You do that in Besidka')
  })

  it('names the skill scopes and says what they cannot do', async () => {
    const read = await mountSuspended(ScopeLabel, {
      props: { scope: 'skills:read', withDescription: true },
    })
    const write = await mountSuspended(ScopeLabel, {
      props: { scope: 'skills:write', withDescription: true },
    })

    expect(read.text()).toContain('See your skills and their full text')
    expect(write.text()).toContain(
      'Add, change and delete skills. Changes are saved switched off for '
      + 'your review',
    )
    expect(write.text()).toContain('permanently delete skills')
    expect(write.text()).toContain('It cannot switch a skill on')
    expect(write.text()).toContain('set it to Auto or share it')
  })

  it('describes what publishing exposes', async () => {
    const wrapper = await mountSuspended(ScopeLabel, {
      props: { scope: 'artifacts:share', withDescription: true },
    })

    expect(wrapper.text()).toContain('Anyone who has the link can open it')
    expect(wrapper.text()).toContain('30 days')
  })

  it('says the files scope also creates documents', async () => {
    const wrapper = await mountSuspended(ScopeLabel, {
      props: { scope: 'files:write', withDescription: true },
    })

    expect(wrapper.text()).toContain(
      'Create text files and documents (PDF, Word, PowerPoint, Excel) and '
      + 'rename files.',
    )
  })

  it('mentions artifacts in the delete description', async () => {
    const wrapper = await mountSuspended(ScopeLabel, {
      props: { scope: 'data:delete', withDescription: true },
    })

    expect(wrapper.text()).toContain('artifacts')
  })

  it('has a readable title for every scope, never the raw id', async () => {
    for (const scope of MCP_OAUTH_SCOPES) {
      const wrapper = await mountSuspended(ScopeLabel, { props: { scope } })

      expect(wrapper.text(), scope).not.toBe(scope)
    }
  })
})
