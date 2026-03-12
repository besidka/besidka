import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export async function refreshFolderActivityAt(
  folderIds: Array<string | null | undefined>,
  userId: number,
  db: ReturnType<typeof useDb>,
) {
  const uniqueFolderIds = [...new Set(folderIds)].filter(
    (folderId): folderId is string => {
      return folderId !== null && folderId !== undefined
    },
  )

  for (const folderId of uniqueFolderIds) {
    const folder = await db.query.folders.findFirst({
      where(folders, { and, eq }) {
        return and(
          eq(folders.id, folderId),
          eq(folders.userId, userId),
        )
      },
      columns: {
        id: true,
        createdAt: true,
      },
    })

    if (!folder) {
      continue
    }

    const latestChat = await db.query.chats.findFirst({
      where(chats, { and, eq }) {
        return and(
          eq(chats.folderId, folder.id),
          eq(chats.userId, userId),
        )
      },
      columns: {
        activityAt: true,
      },
      orderBy(chats, { desc }) {
        return [desc(chats.activityAt)]
      },
    })

    await db.update(schema.folders)
      .set({
        activityAt: latestChat?.activityAt ?? folder.createdAt,
      })
      .where(and(
        eq(schema.folders.id, folder.id),
        eq(schema.folders.userId, userId),
      ))
  }
}
