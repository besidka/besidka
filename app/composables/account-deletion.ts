import { parseError } from 'evlog'

export function useAccountDeletion() {
  const isDeleting = useState<boolean>(
    'account-deletion:is-deleting',
    () => false,
  )

  async function requestAccountDeletion() {
    const result = await useConfirm({
      text: 'Permanently delete your account?',
      subtitle: 'We will email you a confirmation link. Opening it erases your '
        + 'account, chats, projects and files for good — this cannot be undone.',
      alert: true,
      actions: ['Delete account'],
      labelDecline: 'Cancel',
    })

    if (!result) {
      return
    }

    isDeleting.value = true

    try {
      await useAuth().requestAccountDeletion()

      useInfoMessage(
        'Check your email',
        'We sent a link to confirm deleting your account.',
      )
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to request account deletion.',
        parsedException.why,
      )
    } finally {
      isDeleting.value = false
    }
  }

  return {
    isDeleting,
    requestAccountDeletion,
  }
}
