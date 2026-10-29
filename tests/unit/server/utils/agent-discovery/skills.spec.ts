import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SKILLS_DIRECTORY = join(process.cwd(), 'skills')
const ORIGIN = 'https://besidka.com'
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/
const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

const mocks = vi.hoisted(() => {
  return {
    runtimeConfig: {} as Record<string, unknown>,
  }
})

vi.mock('#app/nuxt', () => {
  return {
    useRuntimeConfig: () => {
      return mocks.runtimeConfig
    },
  }
})

vi.mock('nuxt/server', () => {
  return {
    defineEventHandler: (handler: unknown) => {
      return handler
    },
  }
})

interface SkillFile {
  name: string
  description: string
  bytes: Buffer
}

function readSkillFiles(): SkillFile[] {
  return readdirSync(SKILLS_DIRECTORY, { withFileTypes: true })
    .filter((entry) => {
      return entry.isDirectory()
    })
    .map((entry) => {
      const bytes = readFileSync(join(SKILLS_DIRECTORY, entry.name, 'SKILL.md'))
      const frontmatter = FRONTMATTER_PATTERN.exec(bytes.toString('utf8'))![1]!
      const description = /^description:\s*(.+)$/m.exec(frontmatter)![1]!

      return { name: entry.name, description, bytes }
    })
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function stubRuntime(skills: SkillFile[]) {
  mocks.runtimeConfig = {
    public: { baseUrl: ORIGIN },
    agentDiscoverySkills: {
      skills: skills.map((skill) => {
        return { name: skill.name, description: skill.description }
      }),
    },
  }
  vi.stubGlobal('useStorage', () => {
    return {
      getItemRaw: async (key: string) => {
        const [name] = key.split('/')

        return skills.find((skill) => {
          return skill.name === name
        })?.bytes ?? null
      },
    }
  })
}

describe('agent skills discovery', () => {
  const skills = readSkillFiles()

  beforeEach(() => {
    vi.resetModules()
    stubRuntime(skills)
  })

  it('ships at least one skill with a valid name and description', () => {
    expect(skills.length).toBeGreaterThan(0)

    for (const skill of skills) {
      expect(skill.name).toMatch(SKILL_NAME_PATTERN)
      expect(skill.name.length).toBeLessThanOrEqual(64)
      expect(skill.description.length).toBeGreaterThan(20)
    }
  })

  it('emits the Agent Skills Discovery v0.2.0 schema URL', async () => {
    const { buildAgentSkillsIndex } = await import(
      '~~/server/utils/agent-discovery/skills'
    )
    const index = await buildAgentSkillsIndex(ORIGIN)

    expect(index.$schema)
      .toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json')
  })

  it('digests the exact SKILL.md bytes of every skill', async () => {
    const { buildAgentSkillsIndex } = await import(
      '~~/server/utils/agent-discovery/skills'
    )
    const index = await buildAgentSkillsIndex(ORIGIN)

    expect(index.skills).toHaveLength(skills.length)

    for (const skill of skills) {
      const entry = index.skills.find((candidate) => {
        return candidate.name === skill.name
      })

      expect(entry).toEqual({
        name: skill.name,
        type: 'skill-md',
        description: skill.description,
        url: `${ORIGIN}/.well-known/agent-skills/${skill.name}/SKILL.md`,
        digest: sha256(skill.bytes),
      })
    }
  })

  it('serves the same bytes the index digests', async () => {
    const siteOrigin = await import('~~/server/utils/agent-discovery/site-origin')
    const skillsModule = await import('~~/server/utils/agent-discovery/skills')

    vi.stubGlobal('getSiteOrigin', siteOrigin.getSiteOrigin)
    vi.stubGlobal('buildAgentSkillsIndex', skillsModule.buildAgentSkillsIndex)

    const { default: indexHandler } = await import(
      '~~/server/routes/.well-known/agent-skills/index.json.get'
    )
    const event = { url: new URL(ORIGIN), res: { headers: new Headers() } }
    const index = JSON.parse(
      await (indexHandler as (event: unknown) => Promise<string>)(event),
    )

    expect(event.res.headers.get('content-type'))
      .toBe('application/json; charset=utf-8')

    for (const entry of index.skills) {
      const bytes = await skillsModule.readSkillMarkdown(entry.name)

      expect(sha256(Buffer.from(bytes!))).toBe(entry.digest)
    }
  })

  it('refuses names that are not registered skills', async () => {
    const { readSkillMarkdown } = await import(
      '~~/server/utils/agent-discovery/skills'
    )

    expect(await readSkillMarkdown('../etc/passwd')).toBeNull()
    expect(await readSkillMarkdown('unknown-skill')).toBeNull()
  })
})
