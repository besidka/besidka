import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { beforeAll, afterEach, afterAll } from 'vitest'

/**
 * MSW handlers for API mocking
 */
export const handlers = [
  // Auth endpoints
  http.post('/api/auth/sign-in', async ({ request }) => {
    const body = await request.json() as { email: string, password: string }

    if (body.email === 'test@example.com' && body.password === 'password123') {
      return HttpResponse.json({
        session: {
          id: 'session-123',
          userId: 'user-123',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          token: 'mock-token',
        },
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
          emailVerified: true,
        },
      })
    }

    return HttpResponse.json(
      { error: 'Invalid credentials' },
      { status: 401 },
    )
  }),

  http.post('/api/auth/sign-out', () => {
    return HttpResponse.json({ success: true })
  }),

  http.get('/api/auth/get-session', () => {
    return HttpResponse.json({
      session: {
        id: 'session-123',
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      user: {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        emailVerified: true,
      },
    })
  }),

  // Chat endpoints
  http.put('/api/v1/chats/new', async ({ request }) => {
    const body = await request.json() as { message: string, model: string }

    if (!body.message) {
      return HttpResponse.json(
        { error: 'Message is required' },
        { status: 400 },
      )
    }

    return HttpResponse.json({
      slug: 'chat-123',
      title: 'New Chat',
      createdAt: new Date().toISOString(),
    })
  }),

  http.get('/api/v1/chats/history', () => {
    return HttpResponse.json({
      chats: [
        {
          slug: 'chat-123',
          title: 'Test Chat 1',
          createdAt: new Date('2024-01-01').toISOString(),
          model: 'gpt-4',
        },
        {
          slug: 'chat-456',
          title: 'Test Chat 2',
          createdAt: new Date('2024-01-02').toISOString(),
          model: 'gpt-3.5-turbo',
        },
      ],
    })
  }),

  http.post('/api/v1/chats/:slug', async ({ request }) => {
    await request.json() as { message: string }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        const chunks = [
          '0:"Hello "\n',
          '0:"from "\n',
          '0:"AI!"\n',
        ]

        let index = 0
        const interval = setInterval(() => {
          if (index < chunks.length) {
            controller.enqueue(encoder.encode(chunks[index]))
            index++
          } else {
            clearInterval(interval)
            controller.close()
          }
        }, 100)
      },
    })

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })
  }),

  http.patch('/api/v1/chats/:slug/title', async ({ request }) => {
    const body = await request.json() as { title: string }

    if (!body.title) {
      return HttpResponse.json(
        { error: 'Title is required' },
        { status: 400 },
      )
    }

    return HttpResponse.json({
      success: true,
      title: body.title,
    })
  }),

  http.delete('/api/v1/chats/:slug', () => {
    return HttpResponse.json({ success: true })
  }),

  // API keys endpoints
  http.get('/api/v1/keys', () => {
    return HttpResponse.json({
      keys: [
        {
          id: 'key-1',
          provider: 'openai',
          maskedKey: 'sk-...abc',
          createdAt: new Date('2024-01-01').toISOString(),
        },
      ],
    })
  }),

  http.post('/api/v1/keys', async ({ request }) => {
    const body = await request.json() as { provider: string, key: string }

    if (!body.provider || !body.key) {
      return HttpResponse.json(
        { error: 'Provider and key are required' },
        { status: 400 },
      )
    }

    return HttpResponse.json({
      id: 'key-new',
      provider: body.provider,
      maskedKey: body.key.slice(0, 7) + '...' + body.key.slice(-3),
      createdAt: new Date().toISOString(),
    })
  }),

  http.delete('/api/v1/keys/:id', () => {
    return HttpResponse.json({ success: true })
  }),

  // Files endpoints
  http.get('/api/v1/files', ({ request }) => {
    const url = new URL(request.url)
    const offset = parseInt(url.searchParams.get('offset') || '0', 10)
    const limit = parseInt(url.searchParams.get('limit') || '20', 10)
    const search = url.searchParams.get('search') || ''

    const allFiles = [
      {
        id: 'file-1',
        storageKey: 'file-1.png',
        name: 'Screenshot 1.png',
        size: 12345,
        type: 'image/png',
        createdAt: new Date('2024-01-01').toISOString(),
      },
      {
        id: 'file-2',
        storageKey: 'file-2.pdf',
        name: 'Document.pdf',
        size: 45678,
        type: 'application/pdf',
        createdAt: new Date('2024-01-02').toISOString(),
      },
      {
        id: 'file-3',
        storageKey: 'file-3.txt',
        name: 'Notes.txt',
        size: 890,
        type: 'text/plain',
        createdAt: new Date('2024-01-03').toISOString(),
      },
    ]

    const filtered = search
      ? allFiles.filter((file) => {
        return file.name.toLowerCase().includes(search.toLowerCase())
      })
      : allFiles

    const paginated = filtered.slice(offset, offset + limit)

    return HttpResponse.json({
      files: paginated,
      total: filtered.length,
      offset,
      limit,
    })
  }),

  http.post('/api/v1/files/delete/bulk', async ({ request }) => {
    const body = await request.json() as { ids: string[] }
    if (!body.ids?.length) {
      return HttpResponse.json(
        { statusMessage: 'Invalid request body' },
        { status: 400 },
      )
    }

    return HttpResponse.json({ success: true })
  }),

  http.delete('/api/v1/files/:id', ({ params }) => {
    if (!params.id) {
      return HttpResponse.json(
        { statusMessage: 'Missing id' },
        { status: 400 },
      )
    }

    return HttpResponse.json({ success: true })
  }),

  http.patch('/api/v1/files/:id/name', async ({ params, request }) => {
    const body = await request.json() as { name?: string }
    if (!params.id || !body.name) {
      return HttpResponse.json(
        { statusMessage: 'Invalid request body' },
        { status: 400 },
      )
    }

    return HttpResponse.json({
      id: params.id,
      name: body.name,
    })
  }),

  http.get('/api/v1/files/policy', () => {
    return HttpResponse.json({
      policy: {
        tier: 'free',
        maxStorageBytes: 20 * 1024 * 1024,
        maxFilesPerMessage: 10,
        maxMessageFilesBytes: 1000 * 1024 * 1024,
        fileRetentionDays: 30,
        imageTransformLimitTotal: 0,
        imageTransformUsedTotal: 0,
      },
      globalTransformRemainingMonth: 1000,
    })
  }),

  http.get('/api/v1/storage', () => {
    return HttpResponse.json({
      used: 123456,
      total: 1000000,
      percentage: 12,
      tier: 'free',
      maxStorageBytes: 1000000,
      maxFilesPerMessage: 10,
      maxMessageFilesBytes: 1000 * 1024 * 1024,
      fileRetentionDays: 30,
      imageTransformLimitTotal: 0,
      imageTransformUsedTotal: 0,
      globalTransformRemainingMonth: 1000,
    })
  }),
]

/**
 * Create MSW server for Node.js tests
 */
export const server = setupServer(...handlers)

/**
 * Setup MSW for tests
 */
export function setupMSW() {
  beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())
}
