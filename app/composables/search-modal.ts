export function useSearchModal() {
  const { loggedIn } = useAuth()

  const isModalOpen = useState<boolean>('search:is-modal-open', () => false)

  function openSearchModal() {
    if (!loggedIn.value) {
      return
    }

    isModalOpen.value = true
  }

  function closeSearchModal() {
    isModalOpen.value = false
  }

  return {
    isModalOpen,
    openSearchModal,
    closeSearchModal,
  }
}
