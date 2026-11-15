import { and, eq, ne } from 'drizzle-orm'
import { parseGithubSkillUrl } from '#shared/utils/skills/github-url'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

export interface SkillLookalikeContext {
  source: string | null
  otherSkillNames: string[]
}

/**
 * What the lookalike check needs that only the server knows: the GitHub
 * `owner/repo` a skill comes from, and the account's other skill names. The
 * skill that is being checked is left out of its own comparison list.
 */
export async function readSkillLookalikeContext(input: {
  db: DbClient
  userId: number
  sourceUrl: string | null
  excludeSkillId?: string
}): Promise<SkillLookalikeContext> {
  const parsed = input.sourceUrl ? parseGithubSkillUrl(input.sourceUrl) : null
  const conditions = [eq(schema.skills.userId, input.userId)]

  if (input.excludeSkillId) {
    conditions.push(ne(schema.skills.id, input.excludeSkillId))
  }

  const rows = await input.db.select({ name: schema.skills.name })
    .from(schema.skills)
    .where(and(...conditions))

  return {
    source: parsed?.ok ? `${parsed.value.owner}/${parsed.value.repo}` : null,
    otherSkillNames: rows.map((row) => {
      return row.name
    }),
  }
}
