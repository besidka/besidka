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
      where: { id: projectId, userId },
      columns: {
        id: true,
        createdAt: true,
      },
    })

    if (!project) {
      continue
    }

    const latestChat = await db.query.chats.findFirst({
      where: { projectId: project.id, userId },
      columns: {
        activityAt: true,
      },
      orderBy: { activityAt: 'desc' },
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
