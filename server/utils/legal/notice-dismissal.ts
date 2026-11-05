type DbClient = ReturnType<typeof useDb>

export function mergeDismissedLegalNoticeIds(
  storedNoticeIds: readonly string[] | null | undefined,
  addedNoticeIds: readonly string[],
): string[] {
  return [...new Set([...(storedNoticeIds ?? []), ...addedNoticeIds])]
}

export async function readDismissedLegalNoticeIds(
  db: DbClient,
  userId: number,
): Promise<string[]> {
  const settings = await db.query.userSettings.findFirst({
    where: {
      userId,
    },
    columns: {
      dismissedLegalNoticeIds: true,
    },
  })

  return settings?.dismissedLegalNoticeIds ?? []
}
