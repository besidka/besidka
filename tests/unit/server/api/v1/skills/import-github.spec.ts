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
  seedSkillWithFiles,
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

const MIT_LICENSE = [
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
      'LICENSE': MIT_LICENSE,
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

  it('uses the repository-root license when the skill has none', async () => {
    await signIn()

    const result = await preview({
      url: 'https://github.com/o/r/tree/main/skills/review-pr',
    })

    expect(result.license).toMatchObject({
      class: 'open',
      file: 'LICENSE',
      fromRepositoryRoot: true,
    })
    expect(result.requiresLicenseAcknowledgement).toBe(false)
    expect(result.warnings).toEqual([])
  })

  it('ignores the root license when the skill carries its own', async () => {
    await signIn()
    github.archives.set(GITHUB_SHA_ONE, archiveAt(GITHUB_SHA_ONE, {
      'skills/review-pr/LICENSE.txt': 'Custom terms apply to this skill only.\n',
    }))

    const result = await preview({
      url: 'https://github.com/o/r/tree/main/skills/review-pr',
    })

    expect(result.license.file).toBe('LICENSE.txt')
    expect(result.license.fromRepositoryRoot).toBe(false)
    expect(result.license.class).not.toBe('open')
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

  it('still blocks a restricted license for a blob link to SKILL.md', async () => {
    await signIn()
    github.archives.set(GITHUB_SHA_ONE, archiveAt(GITHUB_SHA_ONE, {
      'skills/review-pr/LICENSE.txt': readFileSync(
        'tests/fixtures/skills/licenses/anthropic-proprietary.txt',
        'utf8',
      ),
    }))

    const failure = await failureOf(preview({
      url: 'https://github.com/o/r/blob/main/skills/review-pr/SKILL.md',
    }))

    expect(failure).toMatchObject({ status: 422, code: 'license-restricted' })
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

  it('names what is wrong with a GitHub page link, with the fix given once', async () => {
    await signIn()

    const failure = await failureOf(preview({
      url: 'https://github.com/o/r/issues/1',
    }))

    expect(failure).toMatchObject({
      status: 400,
      message: 'This link cannot be imported',
      why: 'github.com/o/r/issues is a GitHub page, not a folder of the repository',
    })
    expect(failure.fix).toContain('github.com/owner/repo/skills/name')
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

  it('blocks a restricted license before staging', async () => {
    await signIn()
    github.archives.set(GITHUB_SHA_ONE, archiveAt(GITHUB_SHA_ONE, {
      'skills/review-pr/LICENSE.txt': readFileSync(
        'tests/fixtures/skills/licenses/anthropic-proprietary.txt',
        'utf8',
      ),
    }))

    const failure = await failureOf(preview({
      url: 'https://github.com/o/r/tree/main/skills/review-pr',
    }))

    expect(failure).toMatchObject({ status: 422, code: 'license-restricted' })
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

  describe('release tags', () => {
    const LATEST_SHA = '4'.repeat(40)
    const OLDER_SHA = '5'.repeat(40)
    const FOLDER_URL = 'https://github.com/o/r/tree/main/skills/review-pr'

    function addReleases() {
      github.tags.set('2.9.0', { sha: OLDER_SHA })
      github.tags.set('2.10.0', { sha: 'a'.repeat(40), peeled: LATEST_SHA })
      github.tags.set('2.10.0-rc.1', { sha: '6'.repeat(40) })
      github.tags.set('latest', { sha: '7'.repeat(40) })
      github.archives.set(LATEST_SHA, archiveAt(LATEST_SHA))
      github.archives.set(OLDER_SHA, archiveAt(OLDER_SHA))
    }

    it('pins a default-branch link to the highest release tag', async () => {
      await signIn()
      addReleases()

      const result = await preview({ url: FOLDER_URL })

      expect(result).toMatchObject({
        sourceVersion: LATEST_SHA,
        sourceRef: '2.10.0',
        sourcePath: 'skills/review-pr',
        release: {
          tag: '2.10.0',
          isLatestRelease: true,
          latestTag: '2.10.0',
          defaultBranch: 'main',
          channel: 'release',
          switchable: true,
        },
      })
      expect(github.urls().at(-1)).toBe(
        `https://codeload.github.com/o/r/zip/${LATEST_SHA}`,
      )
    })

    it('pins a bare repository link to the highest release tag', async () => {
      await signIn()
      addReleases()

      const result = await preview({ url: 'https://github.com/o/r' })

      expect(result).toMatchObject({
        sourceRef: '2.10.0',
        release: { tag: '2.10.0', channel: 'release' },
      })
    })

    it('pins a link without tree or blob to the latest release too', async () => {
      await signIn()
      addReleases()

      const result = await preview({
        url: 'https://github.com/o/r/skills/review-pr',
      })

      expect(result).toMatchObject({
        sourceRef: '2.10.0',
        sourcePath: 'skills/review-pr',
        release: { tag: '2.10.0', channel: 'release', switchable: true },
      })
    })

    it('keeps the default branch when the user asks for the latest commit', async () => {
      await signIn()
      addReleases()

      const result = await preview({ url: FOLDER_URL, channel: 'branch' })

      expect(result).toMatchObject({
        sourceVersion: GITHUB_SHA_ONE,
        sourceRef: 'main',
        release: {
          tag: null,
          isLatestRelease: false,
          latestTag: '2.10.0',
          channel: 'branch',
          switchable: true,
        },
      })
    })

    it('keeps a link that names another branch and offers no switch', async () => {
      await signIn()
      addReleases()
      github.setBranch('next', GITHUB_SHA_TWO)
      github.archives.set(GITHUB_SHA_TWO, archiveAt(GITHUB_SHA_TWO))

      const result = await preview({
        url: 'https://github.com/o/r/tree/next/skills/review-pr',
      })

      expect(result).toMatchObject({
        sourceVersion: GITHUB_SHA_TWO,
        sourceRef: 'next',
        release: { tag: null, channel: 'branch', switchable: false },
      })
    })

    it('keeps a link that names a tag', async () => {
      await signIn()
      addReleases()

      const result = await preview({
        url: 'https://github.com/o/r/tree/2.9.0/skills/review-pr',
      })

      expect(result).toMatchObject({
        sourceVersion: OLDER_SHA,
        sourceRef: '2.9.0',
        release: { tag: '2.9.0', isLatestRelease: false, switchable: false },
      })
    })

    it('shows the tag of a branch commit that is the tip of a release', async () => {
      await signIn()
      addReleases()
      github.setBranch('next', OLDER_SHA)

      const result = await preview({
        url: 'https://github.com/o/r/tree/next/skills/review-pr',
      })

      expect(result).toMatchObject({
        sourceRef: 'next',
        sourceVersion: OLDER_SHA,
        release: { tag: '2.9.0', isLatestRelease: false },
      })
    })

    it('moves to the next release when the folder is missing from the newest', async () => {
      await signIn()
      addReleases()
      github.archives.set(LATEST_SHA, githubRepoArchive(LATEST_SHA, {
        'README.md': '# Repo\n',
      }))

      const result = await preview({ url: FOLDER_URL })

      expect(result).toMatchObject({
        sourceRef: '2.9.0',
        sourceVersion: OLDER_SHA,
        release: { tag: '2.9.0', isLatestRelease: false },
      })
    })

    it('falls back to the default branch when no release holds the folder', async () => {
      await signIn()
      addReleases()

      for (const sha of [LATEST_SHA, OLDER_SHA]) {
        github.archives.set(sha, githubRepoArchive(sha, {
          'README.md': '# Repo\n',
        }))
      }

      const result = await preview({ url: FOLDER_URL })

      expect(result).toMatchObject({
        sourceRef: 'main',
        sourceVersion: GITHUB_SHA_ONE,
        release: { channel: 'branch', switchable: true },
      })
      expect(result.warnings.join(' ')).toContain('None of the latest releases')
    })

    it('stores the tag as the source ref and the commit as the version', async () => {
      await signIn()
      addReleases()

      const staged = await preview({ url: FOLDER_URL })

      await commit({ stageId: staged.stageId, acknowledged: true })

      const [skill] = await testDb.db.select().from(schema.skills)

      expect(skill).toMatchObject({
        sourceRef: '2.10.0',
        sourceVersion: LATEST_SHA,
      })
    })

    it('imports a skill when the repository has no release', async () => {
      await signIn()

      const result = await preview({ url: FOLDER_URL })

      expect(result).toMatchObject({
        sourceRef: 'main',
        release: { tag: null, switchable: false, channel: 'branch' },
      })
    })
  })

  describe('an already installed skill', () => {
    const FOLDER_URL = 'https://github.com/o/r/tree/main/skills/review-pr'

    function forgetCachedRefs() {
      for (const key of [...kv.values.keys()]) {
        if (key.startsWith('skills:github:')) {
          kv.values.delete(key)
        }
      }
    }

    async function install(url = FOLDER_URL) {
      const staged = await preview({ url })

      return await commit({ stageId: staged.stageId, acknowledged: true })
    }

    it('reports nothing for a skill the account does not have', async () => {
      await signIn()

      expect((await preview({ url: FOLDER_URL })).installed).toBeNull()
    })

    it('says up to date when the same files are imported again', async () => {
      await signIn()
      await install()

      expect((await preview({ url: FOLDER_URL })).installed).toEqual({
        kind: 'same-source',
        skillId: expect.any(String),
        name: 'review-pr',
        sourceLabel: GITHUB_SHA_ONE.slice(0, 7),
        isUpToDate: true,
      })
    })

    it('offers an update when the same folder has other files, and matches the repository case-insensitively', async () => {
      await signIn()
      await install()
      await testDb.db.update(schema.skills)
        .set({ sourceUrl: 'https://github.com/O/R' })
      forgetCachedRefs()
      github.setBranch('main', GITHUB_SHA_TWO)
      github.archives.set(GITHUB_SHA_TWO, archiveAt(GITHUB_SHA_TWO, {
        'skills/review-pr/references/checklist.md': '- Check docs\n',
      }))

      const result = await preview({ url: FOLDER_URL })

      expect(result.installed).toMatchObject({
        kind: 'same-source',
        name: 'review-pr',
        sourceLabel: GITHUB_SHA_ONE.slice(0, 7),
        isUpToDate: false,
      })
    })

    it('shows the release tag the installed copy came from', async () => {
      await signIn()
      github.tags.set('2.1.2', { sha: GITHUB_SHA_ONE })
      await install()
      forgetCachedRefs()
      github.tags.set('2.2.0', { sha: GITHUB_SHA_TWO })
      github.archives.set(GITHUB_SHA_TWO, archiveAt(GITHUB_SHA_TWO, {
        'skills/review-pr/references/checklist.md': '- Check docs\n',
      }))

      expect((await preview({ url: FOLDER_URL })).installed).toMatchObject({
        kind: 'same-source',
        sourceLabel: '2.1.2',
        isUpToDate: false,
      })
    })

    it('recognises a copy that was renamed on the account, and updates it under its own name', async () => {
      await signIn()

      const created = await install()

      await testDb.db.update(schema.skills)
        .set({ name: 'my-review' })
        .where(eq(schema.skills.id, created.id))
      forgetCachedRefs()
      github.setBranch('main', GITHUB_SHA_TWO)
      github.archives.set(GITHUB_SHA_TWO, archiveAt(GITHUB_SHA_TWO, {
        'skills/review-pr/references/checklist.md': '- Check docs\n',
      }))

      const staged = await preview({ url: FOLDER_URL })

      expect(staged.installed).toMatchObject({
        kind: 'same-source',
        name: 'my-review',
        isUpToDate: false,
      })

      const updated = await commit({
        stageId: staged.stageId,
        acknowledged: true,
        asUpdateOf: created.id,
      })
      const [skill] = await testDb.db.select().from(schema.skills)

      expect(updated).toMatchObject({ kind: 'pending', name: 'my-review' })
      expect(skill).toMatchObject({ name: 'my-review', pendingVersion: 2 })
    })

    it('reports a skill of the same name from another source as a name match', async () => {
      await signIn()
      await seedSkillWithFiles(testDb.db, bucket, {
        userId,
        files: { 'SKILL.md': skillMarkdown() },
        skill: { name: 'review-pr', sourceKind: 'zip' },
      })

      expect((await preview({ url: FOLDER_URL })).installed).toMatchObject({
        kind: 'same-name',
        name: 'review-pr',
        isUpToDate: false,
      })
    })

    it('does not report the placeholder of an import that never finished', async () => {
      await signIn()

      const created = await install()

      await testDb.db.delete(schema.skillVersions)
        .where(eq(schema.skillVersions.skillId, created.id))

      expect((await preview({ url: FOLDER_URL })).installed).toBeNull()
    })
  })
})
