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

    // Simulate streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        const chunks = [
          '0:"Hello "\n',
          '0:"from "\n',
          '0:"AI!"\n',
        ]

        let i = 0
        const interval = setInterval(() => {
          if (i < chunks.length) {
            controller.enqueue(encoder.encode(chunks[i]))
            i++
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
