import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import { assertNotCrossSiteRequest } from '~~/server/utils/cross-site-guard'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { createMemoryTestDb } from '../../setup/helpers/memory-db'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  setResponseStatus: vi.fn(),
  cancelBackfill: vi.fn(),
}))

vi.mock('~~/server/utils/memory/backfill', () => ({
  cancelBackfill: mocks.cancelBackfill,
}))

vi.mock('evlog', () => ({
  createError: (input: {
    message: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

const CARD_NUMBER = '4111 1111 1111 1111'
const OWNER = 1
const STRANGER = 2
const SENSITIVE_TOPIC_MESSAGE
  = 'Sensitive topics (health, religion, politics…) are not saved to memory.'
const SETTING_VALUES = [
  { label: 'true', setting: true },
  { label: 'false', setting: false },
  { label: 'null', setting: null },
  { label: 'no settings row', setting: undefined },
] as const

type Handler = (event: any) => Promise<any>

async function loadHandler(path: string): Promise<Handler> {
  const module = await import(/* @vite-ignore */ path)

  return module.default
}

const handlers = {
  list: () => loadHandler('../../../server/api/v1/memory/entries/index.get'),
  create: () => loadHandler('../../../server/api/v1/memory/entries/index.post'),
  get: () => loadHandler(
    '../../../server/api/v1/memory/entries/[id]/index.get',
  ),
  patch: () => loadHandler(
    '../../../server/api/v1/memory/entries/[id]/index.patch',
  ),
  remove: () => loadHandler(
    '../../../server/api/v1/memory/entries/[id]/index.delete',
  ),
  reset: () => loadHandler(
    '../../../server/api/v1/memory/entries/reset.post',
  ),
  exportAll: () => loadHandler('../../../server/api/v1/memory/export.get'),
}

describe('memory entries API', () => {
  let testDb: ReturnType<typeof createMemoryTestDb>
  let sessionUserId: string | null

  function bodyEvent(body: unknown, secFetchSite?: string) {
    return {
      body,
      context: {},
      headers: secFetchSite ? { 'sec-fetch-site': secFetchSite } : {},
      res: { headers: new Headers() },
    }
  }

  function paramsEvent(id: string, body?: unknown, secFetchSite?: string) {
    return {
      body,
      context: { params: { id } },
      headers: secFetchSite ? { 'sec-fetch-site': secFetchSite } : {},
      res: { headers: new Headers() },
    }
  }

  function queryEvent(query: Record<string, string> = {}) {
    return { query, headers: {}, res: { headers: new Headers() } }
  }

  function applySetting(setting: boolean | null | undefined) {
    if (setting === undefined) {
      return
    }

    testDb.insertUserSettings({
      userId: OWNER,
      memoryIncludeSensitive: setting,
    })
  }

  function seed(slug: string, userId: number = OWNER, projectId?: number) {
    testDb.insertEntry({ userId, slug, projectId })
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    testDb = createMemoryTestDb()
    sessionUserId = String(OWNER)

    vi.stubGlobal('defineEventHandler', (handler: any) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', assertNotCrossSiteRequest)
    vi.stubGlobal(
      'getRequestHeader',
      (event: { headers?: Record<string, string> }, name: string) => {
        return event.headers?.[name.toLowerCase()]
      },
    )
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useUserSession', async () => {
      return sessionUserId === null ? null : { user: { id: sessionUserId } }
    })
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal(
      'readValidatedBody',
      async (event: any, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
    vi.stubGlobal('getQuery', (event: { query?: unknown }) => {
      return event.query ?? {}
    })
    vi.stubGlobal('setResponseStatus', mocks.setResponseStatus)
  })

  afterEach(() => {
    testDb.close()
  })

  describe('authentication', () => {
    it('returns 401 for every route without a session', async () => {
      sessionUserId = null

      const calls = [
        [await handlers.list(), queryEvent()],
        [await handlers.create(), bodyEvent({})],
        [await handlers.get(), paramsEvent('x')],
        [await handlers.patch(), paramsEvent('x', { title: 'a' })],
        [await handlers.remove(), paramsEvent('x')],
        [await handlers.reset(), bodyEvent({ scope: 'all' })],
        [await handlers.exportAll(), { context: {}, headers: {} }],
      ] as const

      for (const [handler, event] of calls) {
        await expect(handler(event)).rejects.toMatchObject({ status: 401 })
      }
    })
  })

  describe('cross-site protection', () => {
    it('returns 403 for a cross-site request on every mutating route', async () => {
      testDb.insertEntry({ id: 5, userId: OWNER, slug: 'mine' })

      const calls = [
        [await handlers.create(), bodyEvent({ category: 'topics', title: 'A', description: 'B', body: 'C' }, 'cross-site')],
        [await handlers.patch(), paramsEvent(encodePublicId(5), { title: 'X' }, 'cross-site')],
        [await handlers.remove(), paramsEvent(encodePublicId(5), undefined, 'cross-site')],
        [await handlers.reset(), bodyEvent({ scope: 'all' }, 'cross-site')],
      ] as const

      for (const [handler, event] of calls) {
        await expect(handler(event)).rejects.toMatchObject({ status: 403 })
      }

      expect(testDb.countEntries(OWNER)).toBe(1)
      expect(testDb.sqlite.prepare('select title from memory_entries where id = 5').get())
        .toMatchObject({ title: 'mine' })
    })

    it('does not delete anything for a cross-site reset', async () => {
      const handler = await handlers.reset()

      seed('one')
      seed('two')

      await expect(handler(bodyEvent({ scope: 'all' }, 'cross-site')))
        .rejects.toMatchObject({ status: 403 })
      expect(testDb.countEntries(OWNER)).toBe(2)
    })

    it.each(['same-origin', 'same-site', 'none'])(
      'allows a %s reset',
      async (secFetchSite) => {
        const handler = await handlers.reset()

        seed('one')

        expect(await handler(bodyEvent({ scope: 'all' }, secFetchSite)))
          .toEqual({ deleted: 1 })
      },
    )
  })

  describe('GET /entries', () => {
    it('defaults to the account scope with five ordered groups', async () => {
      const handler = await handlers.list()

      testDb.insertEntry({ userId: OWNER, slug: 'cook', category: 'topics' })
      seed('stranger-entry', STRANGER)
      testDb.insertProject({ id: 7, userId: OWNER })
      seed('project-entry', OWNER, 7)

      const response = await handler(queryEvent())

      expect(response.scope).toBe('account')
      expect(response.projectId).toBeNull()
      expect(response.total).toBe(1)
      expect(response.limits).toEqual({
        maxAccountEntries: MEMORY_LIMITS.maxAccountEntries,
        maxProjectEntries: MEMORY_LIMITS.maxProjectEntries,
        maxBodyBytes: MEMORY_LIMITS.maxBodyBytes,
        maxAlwaysInjectedBodyBytes: MEMORY_LIMITS.maxAlwaysInjectedBodyBytes,
        maxDescriptionChars: MEMORY_LIMITS.maxDescriptionChars,
        maxTitleChars: MEMORY_LIMITS.maxTitleChars,
      })
      expect(response.groups.map((group: any) => group.category)).toEqual([
        'profile',
        'preferences',
        'areas',
        'topics',
        'people',
      ])
      expect(response.groups[3].entries).toHaveLength(1)
      expect(response.groups[3].entries[0]).toMatchObject({ slug: 'cook' })
      expect(response.groups[0].entries).toEqual([])
    })

    it('marks the list response as uncacheable', async () => {
      const handler = await handlers.list()
      const event = queryEvent()

      await handler(event)

      expect(event.res.headers.get('Cache-Control')).toBe('no-store')
    })

    it('lists a project when only projectId is sent', async () => {
      const handler = await handlers.list()

      testDb.insertProject({ id: 7, userId: OWNER })
      seed('account-entry')
      seed('project-entry', OWNER, 7)

      const response = await handler(queryEvent({
        projectId: encodePublicId(7),
      }))

      expect(response.scope).toBe('project')
      expect(response.projectId).toBe(encodePublicId(7))
      expect(response.total).toBe(1)
      expect(response.groups[3].entries[0]).toMatchObject({
        slug: 'project-entry',
      })
    })

    it('lists everything for the all scope', async () => {
      const handler = await handlers.list()

      testDb.insertProject({ id: 7, userId: OWNER })
      seed('account-entry')
      seed('project-entry', OWNER, 7)
      seed('stranger-entry', STRANGER)

      const response = await handler(queryEvent({ scope: 'all' }))

      expect(response.scope).toBe('all')
      expect(response.projectId).toBeNull()
      expect(response.total).toBe(2)
    })

    it('returns 400 for scope=project without a projectId', async () => {
      const handler = await handlers.list()

      await expect(handler(queryEvent({ scope: 'project' })))
        .rejects.toMatchObject({ status: 400 })
    })

    it('returns 400 for an unknown scope', async () => {
      const handler = await handlers.list()

      await expect(handler(queryEvent({ scope: 'everything' })))
        .rejects.toMatchObject({ status: 400 })
    })

    it('returns 404 for a project owned by someone else', async () => {
      const handler = await handlers.list()

      testDb.insertProject({ id: 8, userId: STRANGER })
      seed('secret', STRANGER, 8)

      await expect(handler(queryEvent({ projectId: encodePublicId(8) })))
        .rejects.toMatchObject({ status: 404 })
    })
  })

  describe('POST /entries', () => {
    const validBody = {
      category: 'topics',
      title: 'Cooking',
      description: 'Likes to cook pasta',
      body: 'Cooks pasta twice a week.',
    }

    it('creates an entry with status 201 and a forced origin', async () => {
      const handler = await handlers.create()

      const response = await handler(bodyEvent({
        ...validBody,
        origin: 'import',
        sourceChatIds: ['injected'],
      }))

      expect(mocks.setResponseStatus).toHaveBeenCalledWith(
        expect.anything(),
        201,
      )
      expect(response.entry).toMatchObject({
        projectId: null,
        category: 'topics',
        slug: 'cooking',
        title: 'Cooking',
        origin: 'user',
        sourceChatIds: [],
        sensitivity: 'none',
      })
      expect(testDb.countEntries(OWNER)).toBe(1)
    })

    it.each([
      ['a card number', '4111-1111-1111-1111'],
      ['an Art. 9 health fact', 'living-with-hiv-since-2019'],
    ])('ignores a client slug carrying %s', async (_label, clientSlug) => {
      const handler = await handlers.create()

      const response = await handler(bodyEvent({
        category: 'topics',
        slug: clientSlug,
        title: 'Travel',
        description: 'Trip notes',
        body: 'Likes Lisbon.',
      }))

      expect(response.entry.slug).toBe('travel')
      expect(JSON.stringify(response)).not.toContain(clientSlug)
    })

    it('creates an entry in an owned project', async () => {
      const handler = await handlers.create()

      testDb.insertProject({ id: 7, userId: OWNER })

      const response = await handler(bodyEvent({
        ...validBody,
        projectId: encodePublicId(7),
      }))

      expect(response.entry.projectId).toBe(encodePublicId(7))
    })

    it('returns 404 for a foreign project and stores nothing', async () => {
      const handler = await handlers.create()

      testDb.insertProject({ id: 8, userId: STRANGER })

      await expect(handler(bodyEvent({
        ...validBody,
        projectId: encodePublicId(8),
      }))).rejects.toMatchObject({ status: 404 })
      expect(testDb.countEntries()).toBe(0)
    })

    it('returns 400 for an invalid body', async () => {
      const handler = await handlers.create()

      await expect(handler(bodyEvent({ category: 'topics' })))
        .rejects.toMatchObject({ status: 400 })
      await expect(handler(bodyEvent({ ...validBody, category: 'nope' })))
        .rejects.toMatchObject({ status: 400 })
      await expect(handler(bodyEvent({
        ...validBody,
        category: 'profile',
        body: 'x'.repeat(MEMORY_LIMITS.maxAlwaysInjectedBodyBytes + 1),
      }))).rejects.toMatchObject({ status: 400 })
    })

    it('returns 422 for never-store data without echoing it', async () => {
      const handler = await handlers.create()

      const exception = await handler(bodyEvent({
        ...validBody,
        body: `Card ${CARD_NUMBER}`,
      })).catch((caught: unknown) => {
        return caught as { status: number, why: string }
      })

      expect(exception.status).toBe(422)
      expect(exception.why).not.toContain('4111')
      expect(testDb.countEntries()).toBe(0)
    })

    describe('the sensitive-topic rule', () => {
      const reportedBody = {
        category: 'topics',
        title: 'Health',
        description: 'Diet constraints',
        body: 'I have type 2 diabetes.',
      }

      describe.each(SETTING_VALUES)(
        'with memoryIncludeSensitive $label',
        ({ setting }) => {
          beforeEach(() => {
            applySetting(setting)
          })

          it('returns 422 for the reported health text and stores nothing',
            async () => {
              const handler = await handlers.create()
              const exception = await handler(bodyEvent(reportedBody))
                .catch((caught: unknown) => {
                  return caught as {
                    status: number
                    message: string
                    why: string
                    fix: string
                  }
                })

              expect(exception).toMatchObject({
                status: 422,
                message: SENSITIVE_TOPIC_MESSAGE,
                why: 'This entry looks like sensitive data (health).',
                fix: 'Remove the sensitive details and save again.',
              })
              expect(exception.why).not.toContain('diabetes')
              expect(testDb.countEntries(OWNER)).toBe(0)
            })

          it('returns 422 for the bug-report body, with a none label too',
            async () => {
              const handler = await handlers.create()

              for (const sensitivity of [undefined, 'none']) {
                await expect(handler(bodyEvent({
                  category: 'topics',
                  title: 'Diabetes',
                  description: 'Medical',
                  body: 'I have type 2 diabetes.',
                  sensitivity,
                }))).rejects.toMatchObject({
                  status: 422,
                  message: SENSITIVE_TOPIC_MESSAGE,
                })
              }

              expect(testDb.countEntries(OWNER)).toBe(0)
            })

          it('returns 422 for a client-supplied special and stores nothing',
            async () => {
              const handler = await handlers.create()

              await expect(handler(bodyEvent({
                ...validBody,
                sensitivity: 'special',
                sensitiveCategory: 'health',
              }))).rejects.toMatchObject({
                status: 422,
                message: SENSITIVE_TOPIC_MESSAGE,
              })
              await expect(handler(bodyEvent({
                ...validBody,
                sensitivity: 'special',
              }))).rejects.toMatchObject({ status: 422 })
              expect(testDb.countEntries(OWNER)).toBe(0)
            })

          it('returns 422 for a people entry with health text',
            async () => {
              const handler = await handlers.create()
              const exception = await handler(bodyEvent({
                category: 'people',
                title: 'Anna',
                description: 'Sister',
                body: 'Anna has type 2 diabetes.',
              })).catch((caught: unknown) => {
                return caught as {
                  status: number
                  message: string
                  why: string
                }
              })

              expect(exception).toMatchObject({
                status: 422,
                message: SENSITIVE_TOPIC_MESSAGE,
              })
              expect(exception.why).toContain('(health)')
              expect(testDb.countEntries(OWNER)).toBe(0)
            })

          it('lets never-store beat the sensitive topic', async () => {
            const handler = await handlers.create()

            await expect(handler(bodyEvent({
              ...reportedBody,
              body: `I have type 2 diabetes, card ${CARD_NUMBER}`,
            }))).rejects.toMatchObject({
              status: 422,
              message: 'This memory contains data that cannot be stored',
            })
          })

          it.each([
            ['topics', 'Diet constraints', 'Prefers vegetarian food.'],
            ['topics', 'Church Street address', 'Delivery to Church Street.'],
            ['people', 'Anna: sister', 'Anna: sister, lives in Lviv.'],
          ])('returns 201 for clean %s text "%s", stored as none',
            async (category, title, body) => {
              const handler = await handlers.create()
              const response = await handler(bodyEvent({
                category,
                title,
                description: 'Clean note',
                body,
              }))

              expect(mocks.setResponseStatus).toHaveBeenCalledWith(
                expect.anything(),
                201,
              )
              expect(response.entry).toMatchObject({
                sensitivity: 'none',
                sensitiveCategory: null,
              })
              expect(testDb.sqlite
                .prepare('select sensitivity, sensitive_category '
                  + 'from memory_entries')
                .get()).toEqual({
                sensitivity: 'none',
                sensitive_category: null,
              })
            })
        },
      )

      it('logs the detected category ids and never the text', async () => {
        const handler = await handlers.create()

        await handler(bodyEvent(reportedBody)).catch(() => undefined)

        const logged = JSON.stringify(mocks.loggerSet.mock.calls)

        expect(logged).toContain('"sensitive"')
        expect(logged).toContain('health')
        expect(logged).not.toContain('diabetes')
      })
    })

    it('returns 409 over the cap and for duplicate singletons', async () => {
      const handler = await handlers.create()

      await handler(bodyEvent({ ...validBody, category: 'profile' }))

      await expect(handler(bodyEvent({
        ...validBody,
        category: 'profile',
        title: 'Again',
      }))).rejects.toMatchObject({ status: 409 })

      for (let index = 0; index < MEMORY_LIMITS.maxAccountEntries; index++) {
        if (testDb.countEntries(OWNER) >= MEMORY_LIMITS.maxAccountEntries) {
          break
        }

        seed(`seed-${index}`)
      }

      await expect(handler(bodyEvent(validBody)))
        .rejects.toMatchObject({ status: 409, message: 'Memory limit reached' })
    })

    it('logs the user id and never the entry text', async () => {
      const handler = await handlers.create()

      await handler(bodyEvent(validBody))

      const logged = JSON.stringify(mocks.loggerSet.mock.calls)

      expect(logged).toContain('"userId":1')
      expect(logged).not.toContain('pasta')
    })
  })

  describe('GET /entries/[id]', () => {
    it('returns an owned entry', async () => {
      const handler = await handlers.get()

      testDb.insertEntry({ id: 5, userId: OWNER, slug: 'mine' })

      const response = await handler(paramsEvent(encodePublicId(5)))

      expect(response.entry).toMatchObject({
        id: encodePublicId(5),
        slug: 'mine',
      })
    })

    it('marks the entry response as uncacheable', async () => {
      const handler = await handlers.get()
      const event = paramsEvent(encodePublicId(5))

      testDb.insertEntry({ id: 5, userId: OWNER, slug: 'mine' })

      await handler(event)

      expect(event.res.headers.get('Cache-Control')).toBe('no-store')
    })

    it('returns 404 for another user entry and unknown ids', async () => {
      const handler = await handlers.get()

      testDb.insertEntry({ id: 5, userId: STRANGER, slug: 'secret' })

      await expect(handler(paramsEvent(encodePublicId(5))))
        .rejects.toMatchObject({ status: 404 })
      await expect(handler(paramsEvent(encodePublicId(404))))
        .rejects.toMatchObject({ status: 404 })
      await expect(handler(paramsEvent('not-a-real-id')))
        .rejects.toMatchObject({ status: 404 })
    })
  })

  describe('PATCH /entries/[id]', () => {
    it('updates an owned entry and keeps the slug', async () => {
      const handler = await handlers.patch()

      testDb.insertEntry({ id: 5, userId: OWNER, slug: 'mine' })

      const response = await handler(paramsEvent(encodePublicId(5), {
        title: 'Renamed',
        description: 'New description',
      }))

      expect(response.entry).toMatchObject({
        id: encodePublicId(5),
        slug: 'mine',
        title: 'Renamed',
        description: 'New description',
        origin: 'user',
      })
    })

    it('ignores a slug sent in the patch', async () => {
      const handler = await handlers.patch()

      testDb.insertEntry({ id: 5, userId: OWNER, slug: 'mine' })

      const response = await handler(paramsEvent(encodePublicId(5), {
        title: 'Renamed',
        slug: 'living-with-hiv-since-2019',
      }))

      expect(response.entry.slug).toBe('mine')
    })

    it('re-marks an extraction entry as user-owned', async () => {
      const handler = await handlers.patch()

      testDb.insertEntry({
        id: 5,
        userId: OWNER,
        slug: 'mine',
        origin: 'extraction',
        sourceChatIds: ['chat-1'],
      })

      const response = await handler(paramsEvent(encodePublicId(5), {
        title: 'Edited by the user',
      }))

      expect(response.entry).toMatchObject({
        origin: 'user',
        sourceChatIds: ['chat-1'],
      })
    })

    it('ignores a client-supplied origin on the patch body', async () => {
      const handler = await handlers.patch()

      testDb.insertEntry({
        id: 5,
        userId: OWNER,
        slug: 'mine',
        origin: 'extraction',
      })

      const response = await handler(paramsEvent(encodePublicId(5), {
        title: 'Edited',
        origin: 'tool',
      }))

      expect(response.entry.origin).toBe('user')
    })

    it('returns 400 for an empty or invalid patch', async () => {
      const handler = await handlers.patch()

      testDb.insertEntry({ id: 5, userId: OWNER, slug: 'mine' })

      await expect(handler(paramsEvent(encodePublicId(5), {})))
        .rejects.toMatchObject({ status: 400 })
      await expect(handler(paramsEvent(encodePublicId(5), { title: '' })))
        .rejects.toMatchObject({ status: 400 })
      await expect(handler(paramsEvent(encodePublicId(5), {
        category: 'profile',
        body: 'x'.repeat(MEMORY_LIMITS.maxAlwaysInjectedBodyBytes + 1),
      }))).rejects.toMatchObject({ status: 400 })
    })

    it('returns 404 for another user entry', async () => {
      const handler = await handlers.patch()

      testDb.insertEntry({ id: 5, userId: STRANGER, slug: 'secret' })

      await expect(handler(paramsEvent(encodePublicId(5), { title: 'Mine' })))
        .rejects.toMatchObject({ status: 404 })
    })

    it('returns 422 when the patch carries never-store data', async () => {
      const handler = await handlers.patch()

      testDb.insertEntry({ id: 5, userId: OWNER, slug: 'mine' })

      await expect(handler(paramsEvent(encodePublicId(5), {
        body: `Card ${CARD_NUMBER}`,
      }))).rejects.toMatchObject({ status: 422 })
    })

    describe('the sensitive-topic rule', () => {
      describe.each(SETTING_VALUES)(
        'with memoryIncludeSensitive $label',
        ({ setting }) => {
          beforeEach(() => {
            applySetting(setting)
            testDb.insertEntry({ id: 5, userId: OWNER, slug: 'mine' })
          })

          function readStored() {
            return testDb.sqlite
              .prepare('select title, body, category, sensitivity, '
                + 'sensitive_category from memory_entries where id = 5')
              .get()
          }

          const untouched = {
            title: 'mine',
            body: 'Body of mine',
            category: 'topics',
            sensitivity: 'none',
            sensitive_category: null,
          }

          it('returns 422 for the reported health text and keeps the row',
            async () => {
              const handler = await handlers.patch()
              const exception = await handler(paramsEvent(encodePublicId(5), {
                body: 'I have type 2 diabetes.',
              })).catch((caught: unknown) => {
                return caught as {
                  status: number
                  message: string
                  why: string
                }
              })

              expect(exception).toMatchObject({
                status: 422,
                message: SENSITIVE_TOPIC_MESSAGE,
                why: 'This entry looks like sensitive data (health).',
              })
              expect(exception.why).not.toContain('diabetes')
              expect(readStored()).toEqual(untouched)
            })

          it('returns 422 for a patch that declares special', async () => {
            const handler = await handlers.patch()

            await expect(handler(paramsEvent(encodePublicId(5), {
              sensitivity: 'special',
            }))).rejects.toMatchObject({
              status: 422,
              message: SENSITIVE_TOPIC_MESSAGE,
            })
            await expect(handler(paramsEvent(encodePublicId(5), {
              body: 'I have type 2 diabetes.',
              sensitivity: 'none',
            }))).rejects.toMatchObject({ status: 422 })
            expect(readStored()).toEqual(untouched)
          })

          it('returns 422 for health text in a people entry', async () => {
            testDb.insertEntry({
              id: 6,
              userId: OWNER,
              category: 'people',
              slug: 'anna',
            })

            const handler = await handlers.patch()

            await expect(handler(paramsEvent(encodePublicId(6), {
              body: 'Anna has type 2 diabetes.',
            }))).rejects.toMatchObject({
              status: 422,
              message: SENSITIVE_TOPIC_MESSAGE,
            })
          })

          it('returns 422 when the merged stored text is flagged', async () => {
            testDb.insertEntry({
              id: 7,
              userId: OWNER,
              slug: 'flagged',
              body: 'I have type 2 diabetes.',
            })

            const handler = await handlers.patch()

            await expect(handler(paramsEvent(encodePublicId(7), {
              category: 'people',
            }))).rejects.toMatchObject({ status: 422 })
          })

          it('updates clean text and keeps none with no category',
            async () => {
              const handler = await handlers.patch()
              const response = await handler(paramsEvent(encodePublicId(5), {
                body: 'Prefers vegetarian food.',
              }))

              expect(response.entry).toMatchObject({
                body: 'Prefers vegetarian food.',
                sensitivity: 'none',
                sensitiveCategory: null,
              })
            })

          it('leaves a legacy special row special on a clean-text patch',
            async () => {
              testDb.insertEntry({
                id: 8,
                userId: OWNER,
                slug: 'legacy',
                sensitivity: 'special',
                sensitiveCategory: 'health',
              })

              const handler = await handlers.patch()
              const response = await handler(paramsEvent(encodePublicId(8), {
                body: 'Clean text.',
              }))

              expect(response.entry).toMatchObject({
                body: 'Clean text.',
                sensitivity: 'special',
                sensitiveCategory: 'health',
              })
            })
        },
      )
    })

    it('moves a clean-text entry into people', async () => {
      const handler = await handlers.patch()

      testDb.insertEntry({ id: 5, userId: OWNER, slug: 'mine' })

      const response = await handler(paramsEvent(encodePublicId(5), {
        category: 'people',
      }))

      expect(response.entry).toMatchObject({ category: 'people' })
    })
  })

  describe('DELETE /entries/[id]', () => {
    it('deletes an owned entry and then returns 404', async () => {
      const handler = await handlers.remove()

      testDb.insertEntry({ id: 5, userId: OWNER, slug: 'mine' })

      expect(await handler(paramsEvent(encodePublicId(5))))
        .toEqual({ success: true })
      expect(testDb.countEntries()).toBe(0)

      await expect(handler(paramsEvent(encodePublicId(5))))
        .rejects.toMatchObject({ status: 404 })
    })

    it('returns 404 and keeps another user entry', async () => {
      const handler = await handlers.remove()

      testDb.insertEntry({ id: 5, userId: STRANGER, slug: 'secret' })

      await expect(handler(paramsEvent(encodePublicId(5))))
        .rejects.toMatchObject({ status: 404 })
      expect(testDb.countEntries(STRANGER)).toBe(1)
    })
  })

  describe('POST /entries/reset', () => {
    beforeEach(() => {
      testDb.insertProject({ id: 7, userId: OWNER })
      testDb.insertProject({ id: 9, userId: STRANGER })
      seed('account-one')
      seed('account-two')
      seed('project-entry', OWNER, 7)
      seed('stranger-account', STRANGER)
      seed('stranger-project', STRANGER, 9)
    })

    it('resets the account scope only', async () => {
      const handler = await handlers.reset()

      expect(await handler(bodyEvent({ scope: 'account' })))
        .toEqual({ deleted: 2 })
      expect(testDb.countEntries(OWNER)).toBe(1)
      expect(testDb.countEntries(STRANGER)).toBe(2)
    })

    it.each(['account', 'all'] as const)(
      'cancels the caller\'s running backfill when resetting %s',
      async (scope) => {
        const handler = await handlers.reset()

        await handler(bodyEvent({ scope }))

        expect(mocks.cancelBackfill).toHaveBeenCalledTimes(1)
        expect(mocks.cancelBackfill).toHaveBeenCalledWith(
          expect.objectContaining({ userId: OWNER }),
        )
      },
    )

    it('does not touch the backfill when resetting one project', async () => {
      const handler = await handlers.reset()

      await handler(bodyEvent({
        scope: 'project',
        projectId: encodePublicId(7),
      }))

      expect(mocks.cancelBackfill).not.toHaveBeenCalled()
    })

    it('does not cancel the backfill for an invalid or cross-site reset',
      async () => {
        const handler = await handlers.reset()

        await expect(handler(bodyEvent({ scope: 'nope' }))).rejects.toThrow()
        await expect(handler(bodyEvent({ scope: 'all' }, 'cross-site')))
          .rejects.toThrow()

        expect(mocks.cancelBackfill).not.toHaveBeenCalled()
      })

    it('resets one project', async () => {
      const handler = await handlers.reset()

      expect(await handler(bodyEvent({
        scope: 'project',
        projectId: encodePublicId(7),
      }))).toEqual({ deleted: 1 })
      expect(testDb.countEntries(OWNER)).toBe(2)
    })

    it('resets every entry of the user', async () => {
      const handler = await handlers.reset()

      expect(await handler(bodyEvent({ scope: 'all' })))
        .toEqual({ deleted: 3 })
      expect(testDb.countEntries(STRANGER)).toBe(2)
    })

    it('returns 400 for a project scope without a project id', async () => {
      const handler = await handlers.reset()

      await expect(handler(bodyEvent({ scope: 'project' })))
        .rejects.toMatchObject({ status: 400 })
      await expect(handler(bodyEvent({ scope: 'nope' })))
        .rejects.toMatchObject({ status: 400 })
      await expect(handler(bodyEvent({})))
        .rejects.toMatchObject({ status: 400 })
    })

    it('returns 404 for a foreign project and deletes nothing', async () => {
      const handler = await handlers.reset()

      await expect(handler(bodyEvent({
        scope: 'project',
        projectId: encodePublicId(9),
      }))).rejects.toMatchObject({ status: 404 })
      expect(testDb.countEntries()).toBe(5)
    })
  })

  describe('GET /export', () => {
    it('returns a downloadable, uncached export of own data only', async () => {
      const handler = await handlers.exportAll()
      const headers = new Headers()

      testDb.insertProject({ id: 7, userId: OWNER, name: 'Mine' })
      testDb.insertProject({ id: 9, userId: STRANGER, memory: 'Secret' })
      seed('account-entry')
      seed('project-entry', OWNER, 7)
      seed('stranger-entry', STRANGER)

      const response = await handler({
        context: {},
        res: { headers },
      })

      expect(headers.get('Content-Disposition')).toMatch(
        /^attachment; filename="besidka-memory-export-\d{4}-\d{2}-\d{2}\.json"$/,
      )
      expect(headers.get('Cache-Control')).toBe('no-store')
      expect(response.version).toBe(1)
      expect(response.entries).toHaveLength(2)
      expect(response.projects).toEqual([
        {
          id: encodePublicId(7),
          name: 'Mine',
          useAccountMemory: true,
          legacyMemory: null,
        },
      ])
      expect(response.settings).toMatchObject({
        memoryEnabled: true,
        chatSearchEnabled: true,
      })
      expect(JSON.stringify(response)).not.toContain('Secret')
      expect(JSON.stringify(response)).not.toContain('stranger-entry')
    })
  })
})
