import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  createFakeSkillKv,
} from '../../../../../setup/helpers/skills-db'
import type {
  FakeSkillBucket,
  FakeSkillKv,
} from '../../../../../setup/helpers/skills-db'
import {
  createSkillsRouteEvent,
  stubSkillsRouteGlobals,
} from '../../../../../setup/helpers/skills-route'
import { skillMarkdown } from '../../../../../setup/helpers/skill-archives'
import {
  GITHUB_SHA_ONE,
  GITHUB_SHA_TWO,
  createGithubMock,
  githubRepoArchive,
} from '../../../../../setup/helpers/github-mock'
import type { GithubMock } from '../../../../../setup/helpers/github-mock'

const MIT_LICENCE = [
  'MIT License',
  '',
  'Copyright (c) 2026 Example',
  '',
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'of this software and associated documentation files (the "Software"), to deal',
  'in the Software without restriction, including without limitation the rights',
  'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
  'copies of the Software, and to permit persons to whom the Software is',
  'furnished to do so, subject to the following conditions:',
  '',
  'The above copyright notice and this permission notice shall be included in all',
  'copies or substantial portions of the Software.',
  '',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
  'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
  'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
  'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
  'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
  'SOFTWARE.',
  '',
].join('\n')

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(),
  logger: { set: vi.fn() },
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

vi.mock('nuxt/server', async () => {
  const { skillsNuxtServerMockFactory } = await import(
    '../../../../../setup/helpers/skills-route'
  )

  return await skillsNuxtServerMockFactory()
})

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: async (_event: unknown, flag: string) => {
    if (!mocks.flags.has(flag)) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }

    return { active: true }
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

async function importHandler(path: string) {
  const { default: handler } = await import(path)

  return handler as (input: unknown) => Promise<any>
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as {
      status: number
      code?: string
      message: string
      fix?: string
      why?: string
    }
  }

  throw new Error('Expected a rejection')
}

describe('POST /api/v1/skills/import/preview with { url }', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeSkillKv
  let bucket: FakeSkillBucket
  let github: GithubMock
  let userId: number

  function archiveAt(sha: string, extra: Record<string, string> = {}) {
    return githubRepoArchive(sha, {
      'README.md': '# Repo\n',
      'LICENSE': MIT_LICENCE,
      'skills/review-pr/SKILL.md': skillMarkdown(),
      'skills/review-pr/references/checklist.md': '- Check tests\n',
      ...extra,
    })
  }

  async function preview(body: unknown) {
    const handler = await importHandler(
      '~~/server/api/v1/skills/import/preview.post',
    )

    return await handler(createSkillsRouteEvent({
      body,
      headers: { 'content-type': 'application/json' },
    }))
  }

  async function commit(body: unknown) {
    const handler = await importHandler(
      '~~/server/api/v1/skills/import/commit.post',
    )

    return await handler(createSkillsRouteEvent({ body }))
  }

  beforeEach(() => {
    mocks.flags = new Set(['skills', 'skills.import-url'])
    testDb = createMemoryExtractionTestDb()
    kv = createFakeSkillKv()
    bucket = createFakeSkillBucket()
    github = createGithubMock()
    github.setBranch('main', GITHUB_SHA_ONE)
    github.archives.set(GITHUB_SHA_ONE, archiveAt(GITHUB_SHA_ONE))
    vi.stubGlobal('fetch', github.fetch)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function signIn() {
    userId = await seedUser(testDb.db, null)
    stubSkillsRouteGlobals({ userId, db: testDb.db, kv, bucket })
  }

  it('answers 404 without calling GitHub when skills.import-url is off', async () => {
    await signIn()
    mocks.flags.delete('skills.import-url')

    const failure = await failureOf(preview({
      url: 'https://github.com/o/r/tree/main/skills/review-pr',
    }))

    expect(failure.status).toBe(404)
    expect(github.fetch).not.toHaveBeenCalled()
  })

  it('answers 404 when the skills flag itself is off', async () => {
    await signIn()
    mocks.flags.delete('skills')

    expect((await failureOf(preview({
      url: 'https://github.com/o/r',
    }))).status).toBe(404)
  })

  it('answers 401 without a session', async () => {
    stubSkillsRouteGlobals({ userId: 0, db: null, kv, bucket })

    expect((await failureOf(preview({
      url: 'https://github.com/o/r',
    }))).status).toBe(401)
  })

  it('stages a folder pinned to the resolved commit', async () => {
    await signIn()

    const result = await preview({
      url: 'https://github.com/o/r/tree/main/skills/review-pr',
    })

    expect(result).toMatchObject({
      source: 'github',
      sourceVersion: GITHUB_SHA_ONE,
      sourceUrl: 'https://github.com/o/r',
      sourceRef: 'main',
      sourcePath: 'skills/review-pr',
      skill: { name: 'review-pr' },
    })
    expect(result.files.map((file: { path: string }) => {
      return file.path
    })).toEqual(['SKILL.md', 'LICENSE', 'references/checklist.md'])
    expect(github.urls()).toEqual([
      'https://github.com/o/r.git/info/refs?service=git-upload-pack',
      `https://codeload.github.com/o/r/zip/${GITHUB_SHA_ONE}`,
    ])
    expect(github.urls().some((url) => {
      return url.includes('api.github.com')
    })).toBe(false)
  })

  it('uses the repository-root licence when the skill has none', async () => {
    await signIn()

    const result = await preview({
      url: 'https://github.com/o/r/tree/main/skills/review-pr',
    })

    expect(result.licence).toMatchObject({ class: 'open', file: 'LICENSE' })
    expect(result.requiresLicenceAcknowledgement).toBe(false)
    expect(result.warnings.join(' ')).toContain('licence of the repository root')
  })

  it('ignores the root licence when the skill carries its own', async () => {
    await signIn()
    github.archives.set(GITHUB_SHA_ONE, archiveAt(GITHUB_SHA_ONE, {
      'skills/review-pr/LICENSE.txt': 'Custom terms apply to this skill only.\n',
    }))

    const result = await preview({
      url: 'https://github.com/o/r/tree/main/skills/review-pr',
    })

    expect(result.licence.file).toBe('LICENSE.txt')
    expect(result.licence.class).not.toBe('open')
  })

  it('treats a blob link to SKILL.md as its parent folder and reads the archive', async () => {
    await signIn()

    const result = await preview({
      url: 'https://github.com/o/r/blob/main/skills/review-pr/SKILL.md',
    })

    expect(result.sourcePath).toBe('skills/review-pr')
    expect(result.files.map((file: { path: string }) => file.path))
      .toEqual(['SKILL.md', 'LICENSE', 'references/checklist.md'])
    expect(github.urls()).toEqual([
      'https://github.com/o/r.git/info/refs?service=git-upload-pack',
      `https://codeload.github.com/o/r/zip/${GITHUB_SHA_ONE}`,
    ])
  })

  it('still blocks a restricted licence for a blob link to SKILL.md', async () => {
    await signIn()
    github.archives.set(GITHUB_SHA_ONE, archiveAt(GITHUB_SHA_ONE, {
      'skills/review-pr/LICENSE.txt': readFileSync(
        'tests/fixtures/skills/licences/anthropic-proprietary.txt',
        'utf8',
      ),
    }))

    const failure = await failureOf(preview({
      url: 'https://github.com/o/r/blob/main/skills/review-pr/SKILL.md',
    }))

    expect(failure).toMatchObject({ status: 422, code: 'licence-restricted' })
  })

  it('finds the only skill from a bare repository link', async () => {
    await signIn()

    const result = await preview({ url: 'github.com/o/r' })

    expect(result).toMatchObject({
      sourceRef: 'HEAD',
      sourcePath: 'skills/review-pr',
    })
  })

  it('returns a pick list for a repository with several skills', async () => {
    await signIn()
    github.archives.set(GITHUB_SHA_ONE, archiveAt(GITHUB_SHA_ONE, {
      'skills/second/SKILL.md': skillMarkdown({ name: 'second' }),
    }))

    const result = await preview({ url: 'https://github.com/o/r' })

    expect(result).toEqual({
      pick: {
        owner: 'o',
        repo: 'r',
        ref: 'HEAD',
        sha: GITHUB_SHA_ONE,
        total: 2,
        truncated: false,
        max: 10,
        candidates: [
          { path: 'skills/review-pr', name: 'review-pr' },
          { path: 'skills/second', name: 'second' },
        ],
      },
    })
    expect([...kv.values.keys()].some((key) => {
      return key.startsWith('skills:stage:')
    })).toBe(false)

    const picked = await preview({
      url: 'https://github.com/o/r',
      path: 'skills/second',
    })

    expect(picked).toMatchObject({
      sourcePath: 'skills/second',
      skill: { name: 'second' },
    })
  })

  it('maps a missing or private repository to a clear 404', async () => {
    await signIn()
    github.repoStatus = 404

    const failure = await failureOf(preview({ url: 'https://github.com/o/r' }))

    expect(failure).toMatchObject({
      status: 404,
      message: 'Private or missing repository',
    })
  })

  it('maps an unknown branch to its own message', async () => {
    await signIn()

    const failure = await failureOf(preview({
      url: 'https://github.com/o/r/tree/nope/skills/a',
    }))

    expect(failure).toMatchObject({ status: 404, code: 'github-ref-not-found' })
  })

  it('maps GitHub rate limiting to its message and fix', async () => {
    await signIn()
    github.fetch.mockImplementationOnce(async () => {
      return new Response('', { status: 429 })
    })

    const failure = await failureOf(preview({ url: 'https://github.com/o/r' }))

    expect(failure).toMatchObject({
      status: 429,
      code: 'github-rate-limited',
      message: 'GitHub rate limit reached',
      fix: 'Try again in a few minutes or upload a zip',
    })
  })

  it('warns that a commit which is not a branch or tag tip cannot be confirmed (K18)', async () => {
    await signIn()
    github.archives.set(GITHUB_SHA_TWO, archiveAt(GITHUB_SHA_TWO))

    const result = await preview({
      url: `https://github.com/o/r/commit/${GITHUB_SHA_TWO}`,
      path: 'skills/review-pr',
    })

    expect(result.sourceVersion).toBe(GITHUB_SHA_TWO)
    expect(result.warnings.join(' ')).toContain('cannot confirm that commit')
  })

  it('imports the tip of a branch by its commit id without that warning', async () => {
    await signIn()

    const result = await preview({
      url: `https://github.com/o/r/commit/${GITHUB_SHA_ONE}`,
      path: 'skills/review-pr',
    })

    expect(result).toMatchObject({
      sourceRef: GITHUB_SHA_ONE,
      sourceVersion: GITHUB_SHA_ONE,
      sourcePath: 'skills/review-pr',
    })
    expect(result.warnings.join(' ')).not.toContain('cannot confirm')
  })

  it.each([
    ['another host', { url: 'https://gitlab.com/o/r' }],
    ['plain http', { url: 'http://github.com/o/r' }],
    ['a missing url', {}],
    ['a bad path', { url: 'https://github.com/o/r', path: '../etc' }],
  ])('answers 400 for %s without calling GitHub', async (_label, body) => {
    await signIn()

    const failure = await failureOf(preview(body))

    expect(failure.status).toBe(400)
    expect(github.fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['pull/1/head', 'https://github.com/o/r/tree/pull/1/head/skills/review-pr'],
    ['pull/1/merge', 'https://github.com/o/r/tree/pull/1/merge/skills/review-pr'],
    ['a blob on a pull ref', 'https://github.com/o/r/blob/pull/1/head/SKILL.md'],
    ['refs/pull', 'https://github.com/o/r/tree/refs/pull/1/head'],
  ])('refuses %s without calling GitHub (K18)', async (_label, url) => {
    await signIn()

    const failure = await failureOf(preview({ url }))

    expect(failure.status).toBe(400)
    expect(failure.why).toContain('Pull request and internal refs')
    expect(github.fetch).not.toHaveBeenCalled()
  })

  it('does not echo the validation message of a bad body', async () => {
    await signIn()

    const failure = await failureOf(preview({ url: 42, extra: '<script>' }))

    expect(failure).toMatchObject({
      status: 400,
      why: 'The body must be { url, path? } with a github.com link',
    })
  })

  it('answers 413 for an archive over the cap', async () => {
    await signIn()
    github.fetch.mockImplementationOnce(async () => {
      return new Response(github.advertisement() as BodyInit)
    })
    github.fetch.mockImplementationOnce(async () => {
      return new Response('x', {
        headers: { 'content-length': String(26 * 1024 * 1024) },
      })
    })

    const failure = await failureOf(preview({
      url: 'https://github.com/o/r/tree/main/skills/review-pr',
    }))

    expect(failure).toMatchObject({ status: 413, code: 'github-too-large' })
  })

  it('blocks a restricted licence before staging', async () => {
    await signIn()
    github.archives.set(GITHUB_SHA_ONE, archiveAt(GITHUB_SHA_ONE, {
      'skills/review-pr/LICENSE.txt': readFileSync(
        'tests/fixtures/skills/licences/anthropic-proprietary.txt',
        'utf8',
      ),
    }))

    const failure = await failureOf(preview({
      url: 'https://github.com/o/r/tree/main/skills/review-pr',
    }))

    expect(failure).toMatchObject({ status: 422, code: 'licence-restricted' })
  })

  it('commits the staged import with its GitHub provenance, disabled', async () => {
    await signIn()

    const staged = await preview({
      url: 'https://github.com/o/r/tree/main/skills/review-pr',
    })
    const created = await commit({
      stageId: staged.stageId,
      acknowledged: true,
    })
    const [skill] = await testDb.db.select().from(schema.skills)
    const [version] = await testDb.db.select().from(schema.skillVersions)

    expect(created).toMatchObject({ kind: 'created', enabled: false })
    expect(skill).toMatchObject({
      sourceKind: 'github',
      sourceUrl: 'https://github.com/o/r',
      sourceRef: 'main',
      sourcePath: 'skills/review-pr',
      sourceVersion: GITHUB_SHA_ONE,
      enabled: false,
      licenseClass: 'open',
    })
    expect(version).toMatchObject({
      origin: 'import',
      sourceKind: 'github',
      sourceUrl: 'https://github.com/o/r',
      sourceRef: 'main',
      sourcePath: 'skills/review-pr',
      sourceVersion: GITHUB_SHA_ONE,
    })
    expect(await testDb.db.select().from(schema.skillFiles).where(and(
      eq(schema.skillFiles.skillId, skill!.id),
      eq(schema.skillFiles.path, 'LICENSE'),
    ))).toHaveLength(1)
  })
})
