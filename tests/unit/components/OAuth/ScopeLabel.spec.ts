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

  it('describes what publishing exposes', async () => {
    const wrapper = await mountSuspended(ScopeLabel, {
      props: { scope: 'artifacts:share', withDescription: true },
    })

    expect(wrapper.text()).toContain('Anyone who has the link can open it')
    expect(wrapper.text()).toContain('30 days')
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
