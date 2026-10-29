import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    skills: new Map<string, Uint8Array>(),
  }
})

vi.mock('nuxt/server', () => {
  return {
    defineEventHandler: (handler: unknown) => {
      return handler
    },
    getRouterParams: (event: { context: { params: unknown } }) => {
      return event.context.params
    },
  }
})

function createEvent(name: string) {
  return {
    context: { params: { name } },
    res: { headers: new Headers() },
  }
}

async function callRoute(name: string) {
  vi.stubGlobal('AGENT_SKILLS_PATH', '/.well-known/agent-skills')
  vi.stubGlobal('readSkillMarkdown', async (skillName: string) => {
    return mocks.skills.get(skillName) ?? null
  })

  const { default: handler } = await import(
    '~~/server/routes/.well-known/agent-skills/[name]/SKILL.md.get'
  )
  const event = createEvent(name)

  return {
    event,
    result: (handler as (event: unknown) => Promise<unknown>)(event),
  }
}

describe('GET /.well-known/agent-skills/:name/SKILL.md', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.skills.clear()
    mocks.skills.set(
      'besidka-overview',
      new TextEncoder().encode('---\nname: besidka-overview\n---\n'),
    )
  })

  it('serves a registered skill as markdown with open CORS', async () => {
    const { event, result } = await callRoute('besidka-overview')

    expect(await result).toBeInstanceOf(Uint8Array)
    expect(event.res.headers.get('content-type'))
      .toBe('text/markdown; charset=utf-8')
    expect(event.res.headers.get('access-control-allow-origin')).toBe('*')
    expect(event.res.headers.get('cache-control'))
      .toBe('public, max-age=3600')
  })

  it('answers an unregistered skill with a 404', async () => {
    const { result } = await callRoute('does-not-exist')

    await expect(result).rejects.toMatchObject({
      status: 404,
      message: 'Skill not found',
    })
  })

  it('never echoes the requested name back in the error', async () => {
    const { result } = await callRoute('<script>alert(1)</script>')

    await expect(result).rejects.toSatisfy((exception: unknown) => {
      return !JSON.stringify(exception).includes('script')
    })
  })
})
