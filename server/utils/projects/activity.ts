import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export async function refreshProjectActivityAt(
  projectIds: Array<string | null | undefined>,
  userId: number,
  db: ReturnType<typeof useDb>,
) {
  const uniqueProjectIds = [...new Set(projectIds)].filter(
    (projectId): projectId is string => {
      return projectId !== null && projectId !== undefined
    },
  )

  for (const projectId of uniqueProjectIds) {
    const project = await db.query.projects.findFirst({
      where(projects, { and, eq }) {
        return and(
          eq(projects.id, projectId),
          eq(projects.userId, userId),
        )
      },
      columns: {
        id: true,
        createdAt: true,
      },
    })

    if (!project) {
      continue
    }

    const latestChat = await db.query.chats.findFirst({
      where(chats, { and, eq }) {
        return and(
          eq(chats.projectId, project.id),
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

    await db.update(schema.projects)
      .set({
        activityAt: latestChat?.activityAt ?? project.createdAt,
      })
      .where(and(
        eq(schema.projects.id, project.id),
        eq(schema.projects.userId, userId),
      ))
  }
}
