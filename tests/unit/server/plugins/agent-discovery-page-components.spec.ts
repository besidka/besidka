import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#app/nuxt', () => {
  return {
    useRuntimeConfig: () => {
      return { public: { privacyEmail: 'privacy@besidka.com' } }
    },
  }
})

type DocumentHook = (event: unknown, page: unknown) => void

const PRIVACY_EMAIL = 'privacy@besidka.com'

async function registerDocumentHook(): Promise<DocumentHook> {
  const hooks = new Map<string, DocumentHook>()

  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)

  const { default: plugin } = await import(
    '~~/server/plugins/agent-discovery-page-components'
  )

  ;(plugin as unknown as (nitroApp: unknown) => void)({
    hooks: {
      hook: (name: string, handler: DocumentHook) => {
        hooks.set(name, handler)
      },
    },
  })

  return hooks.get('agent-discovery:document')!
}

describe('agent-discovery-page-components nitro plugin', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('registers on the agent-discovery:document hook', async () => {
    expect(await registerDocumentHook()).toBeTypeOf('function')
  })

  it('renders the contact address in place of the email component', async () => {
    const hook = await registerDocumentHook()
    const page = {
      body: {
        value: [
          ['ul', {}, ['li', {}, 'Email: ',
            ['strong', {}, ['privacy-email-link', {}]]]],
        ],
      },
    }

    hook({}, page)

    expect(page.body.value).toEqual([
      ['ul', {}, ['li', {}, 'Email: ', ['strong', {}, PRIVACY_EMAIL]]],
    ])
  })

  it('renders the account email list as three numbered items', async () => {
    const hook = await registerDocumentHook()
    const page = { body: { value: [['account-email-list', {}]] } }

    hook({}, page)

    const [paragraph] = page.body.value as [string, object, string][]
    const items = paragraph[2].split('\n')

    expect(paragraph[0]).toBe('p')
    expect(items).toHaveLength(3)
    expect(items[0]).toMatch(/^1\. \*\*Address and password:\*\* /)
    expect(items[1]).toMatch(/^2\. \*\*Account deletion:\*\* /)
    expect(items[2]).toMatch(/^3\. \*\*Security notices\*\*, /)
    expect(JSON.stringify(page.body.value)).not.toContain('account-email-list')
  })

  it('skips a page that has no body array', async () => {
    const hook = await registerDocumentHook()

    expect(() => hook({}, {})).not.toThrow()
    expect(() => hook({}, { body: { value: null } })).not.toThrow()
  })
})
