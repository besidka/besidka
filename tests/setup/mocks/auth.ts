import { vi } from 'vitest'

export interface MockSession {
  id: string
  userId: string
  expiresAt: Date
  token: string
  ipAddress: string | null
  userAgent: string | null
}

export interface MockUser {
  id: string
  email: string
  emailVerified: boolean
  name: string
  createdAt: Date
  updatedAt: Date
  image: string | null
  role: string | null
  banned: boolean | null
  banReason: string | null
  banExpires: Date | null
}

/**
 * Create a mock session object for testing
 */
export function createMockSession(
  overrides: Partial<MockSession> = {},
): MockSession {
  return {
    id: 'session-123',
    userId: 'user-123',
    // 7 days from now
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    token: 'mock-token-abc123',
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0 (Test Browser)',
    ...overrides,
  }
}

/**
 * Create a mock user object for testing
 */
export function createMockUser(
  overrides: Partial<MockUser> = {},
): MockUser {
  return {
    id: 'user-123',
    email: 'test@example.com',
    emailVerified: true,
    name: 'Test User',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    image: null,
    role: null,
    banned: null,
    banReason: null,
    banExpires: null,
    ...overrides,
  }
}

/**
 * Mock the useAuth composable with custom session/user data
 */
export function mockAuthComposable(
  options: {
    session?: MockSession | null
    user?: MockUser | null
    loggedIn?: boolean
  } = {},
) {
  const session = ref(
    options.session !== undefined ? options.session : null,
  )
  const user = ref(options.user !== undefined ? options.user : null)
  const loggedIn = computed(() =>
    options.loggedIn !== undefined ? options.loggedIn : !!session.value,
  )

  return {
    session,
    user,
    loggedIn,
    signIn: {
      email: vi.fn(),
    },
    signUp: {
      email: vi.fn(),
    },
    signOut: vi.fn(),
    forgetPassword: vi.fn(),
    resetPassword: vi.fn(),
    fetchSession: vi.fn(),
    errorCodes: {
      INVALID_EMAIL: 'INVALID_EMAIL',
      INVALID_PASSWORD: 'INVALID_PASSWORD',
      USER_NOT_FOUND: 'USER_NOT_FOUND',
    },
    options: {
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
    },
    client: {
      getSession: vi.fn(() => Promise.resolve({ data: null })),
      $store: {
        listen: vi.fn(),
      },
    },
  }
}
