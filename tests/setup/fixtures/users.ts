/**
 * Test fixtures for users
 */

export interface TestUser {
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

export function createMockUser(overrides: Partial<TestUser> = {}): TestUser {
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

export const testUsers = {
  valid: createMockUser(),
  unverified: createMockUser({
    id: 'user-456',
    email: 'unverified@example.com',
    emailVerified: false,
  }),
  admin: createMockUser({
    id: 'user-admin',
    email: 'admin@example.com',
    role: 'admin',
  }),
  banned: createMockUser({
    id: 'user-banned',
    email: 'banned@example.com',
    banned: true,
    banReason: 'Violation of terms',
    banExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }),
}
