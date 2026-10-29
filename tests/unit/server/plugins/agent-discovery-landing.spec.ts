import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    keyGuides: [] as Array<{ title: string, path: string }>,
    queryCollection: vi.fn(),
    buildLandingBody: vi.fn(),
  }
})

vi.mock('@nuxt/content/server', () => {
  return { queryCollection: mocks.queryCollection }
})

vi.mock('~~/server/utils/agent-discovery/landing-markdown', () => {
  return { buildLandingBody: mocks.buildLandingBody }
})

type DocumentHook = (event: unknown, page: unknown) => Promise<void>

async function registerDocumentHook(): Promise<DocumentHook> {
  const hooks = new Map<string, DocumentHook>()

  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)

  const { default: plugin } = await import(
    '~~/server/plugins/agent-discovery-landing'
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

describe('agent-discovery-landing nitro plugin', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.queryCollection.mockReset()
    mocks.buildLandingBody.mockReset()
    mocks.keyGuides = [
      { title: 'Claude key', path: '/guides/claude-api-key' },
    ]
    mocks.queryCollection.mockReturnValue({
      select: () => {
        return {
          order: () => {
            return { all: async () => mocks.keyGuides }
          },
        }
      },
    })
    mocks.buildLandingBody.mockReturnValue([['p', {}, 'Rebuilt']])
  })

  it('registers on the agent-discovery:document hook', async () => {
    expect(await registerDocumentHook()).toBeTypeOf('function')
  })

  it('rebuilds the body of the landing page from the key guides', async () => {
    const hook = await registerDocumentHook()
    const page = { path: '/', body: { value: [['home-bubble', {}]] } }

    await hook({}, page)

    expect(mocks.buildLandingBody).toHaveBeenCalledWith(page, [
      { title: 'Claude key', path: '/guides/claude-api-key' },
    ])
    expect(page.body.value).toEqual([['p', {}, 'Rebuilt']])
  })

  it('leaves every other page untouched', async () => {
    const hook = await registerDocumentHook()
    const page = { path: '/byok', body: { value: ['text'] } }

    await hook({}, page)

    expect(mocks.queryCollection).not.toHaveBeenCalled()
    expect(page.body.value).toEqual(['text'])
  })

  it('skips a landing page that has no body array', async () => {
    const hook = await registerDocumentHook()

    await expect(hook({}, { path: '/' })).resolves.toBeUndefined()
    await expect(hook({}, { path: '/', body: { nodes: [] } }))
      .resolves.toBeUndefined()
    await expect(hook({}, { path: '/', body: { value: null } }))
      .resolves.toBeUndefined()

    expect(mocks.queryCollection).not.toHaveBeenCalled()
    expect(mocks.buildLandingBody).not.toHaveBeenCalled()
  })
})
