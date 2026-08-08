import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSearchModal } from '../../../app/composables/search-modal'

const mocks = vi.hoisted(() => ({
  loggedIn: { value: true },
}))

mockNuxtImport('useAuth', () => {
  return () => ({ loggedIn: mocks.loggedIn })
})

function resetSearchModalState() {
  useSearchModal().isModalOpen.value = false
}

describe('useSearchModal', () => {
  beforeEach(() => {
    mocks.loggedIn.value = true
    resetSearchModalState()
  })

  it('starts closed', () => {
    const { isModalOpen } = useSearchModal()

    expect(isModalOpen.value).toBe(false)
  })

  it('opens the modal when the user is logged in', () => {
    const { isModalOpen, openSearchModal } = useSearchModal()

    openSearchModal()

    expect(isModalOpen.value).toBe(true)
  })

  it('does not open the modal when the user is logged out', () => {
    mocks.loggedIn.value = false

    const { isModalOpen, openSearchModal } = useSearchModal()

    openSearchModal()

    expect(isModalOpen.value).toBe(false)
  })

  it('closes the modal unconditionally, regardless of auth state', () => {
    const { isModalOpen, openSearchModal, closeSearchModal } = useSearchModal()

    openSearchModal()
    expect(isModalOpen.value).toBe(true)

    mocks.loggedIn.value = false
    closeSearchModal()

    expect(isModalOpen.value).toBe(false)
  })

  it('shares isModalOpen across separate call sites', () => {
    const sidebarInstance = useSearchModal()
    const modalInstance = useSearchModal()

    sidebarInstance.openSearchModal()

    expect(modalInstance.isModalOpen.value).toBe(true)

    modalInstance.closeSearchModal()

    expect(sidebarInstance.isModalOpen.value).toBe(false)
  })
})
