export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const settings = await useDb().query.userSettings.findFirst({
    where: {
      userId: parseInt(session.user.id),
    },
    columns: {
      reasoningExpanded: true,
      reasoningAutoHide: true,
      allowExternalLinks: true,
      notificationPromptState: true,
      sidebarPinned: true,
    },
  })

  return {
    reasoningExpanded: settings?.reasoningExpanded ?? false,
    reasoningAutoHide: settings?.reasoningAutoHide ?? true,
    allowExternalLinks: settings?.allowExternalLinks ?? null,
    notificationPromptState: settings?.notificationPromptState ?? null,
    sidebarPinned: settings?.sidebarPinned ?? false,
  }
})
