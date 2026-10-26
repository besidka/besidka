import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTypesafeRoles } from '../../../app/composables/typesafe-roles'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  useLazyFetch: vi.fn(),
  errorMessage: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)

function withSettings(
  typesafeRoles: Record<string, boolean> | null,
  status = 'success',
) {
  mocks.useLazyFetch.mockReturnValue({
    data: ref({ typesafeRoles }),
    status: ref(status),
  })
}

describe('useTypesafeRoles', () => {
  beforeEach(() => {
    mocks.fetch.mockReset().mockResolvedValue({})
    mocks.useLazyFetch.mockReset()
    mocks.errorMessage.mockReset()
  })

  it('fetches only the role settings, client side', () => {
    withSettings(null)

    useTypesafeRoles()

    const [url, options] = mocks.useLazyFetch.mock.calls[0]!

    expect(url).toBe('/api/v1/profiles/settings')
    expect(options).toMatchObject({
      key: 'typesafe-roles',
      server: false,
      pick: ['typesafeRoles'],
    })
  })

  it('reports loading until the settings arrive', () => {
    withSettings(null, 'pending')

    expect(useTypesafeRoles().isLoaded.value).toBe(false)
  })

  it('treats null and missing roles as on', () => {
    withSettings({ rerank: false })

    const { isRoleOn } = useTypesafeRoles()

    expect(isRoleOn('rerank')).toBe(false)
    expect(isRoleOn('autoWebSearch')).toBe(true)
  })

  it('saves only the flipped role', async () => {
    withSettings(null)

    const { isRoleOn, setRole } = useTypesafeRoles()

    await setRole('sharePiiCheck', false)

    expect(isRoleOn('sharePiiCheck')).toBe(false)
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/profiles/settings', {
      method: 'PATCH',
      body: { typesafeRoles: { sharePiiCheck: false } },
    })
  })

  it('rolls the role back and shows an error when the save fails',
    async () => {
      withSettings(null)
      mocks.fetch.mockRejectedValue(new Error('Server down'))

      const { isRoleOn, setRole } = useTypesafeRoles()

      await setRole('rerank', false)

      expect(isRoleOn('rerank')).toBe(true)
      expect(mocks.errorMessage).toHaveBeenCalledTimes(1)
    })

  it('keeps a newer flip when an older save fails', async () => {
    withSettings(null)

    let rejectFirst: (reason: unknown) => void = () => {}

    mocks.fetch
      .mockImplementationOnce(() => {
        return new Promise((_resolve, reject) => {
          rejectFirst = reject
        })
      })
      .mockResolvedValueOnce({})

    const { isRoleOn, setRole } = useTypesafeRoles()
    const first = setRole('rerank', false)

    await setRole('rerank', true)
    rejectFirst(new Error('Server down'))
    await first

    expect(isRoleOn('rerank')).toBe(true)
  })
})
