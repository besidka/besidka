import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractSkillArchive } from '#shared/utils/skills/archive'
import {
  handleSkillImportWorkerRequest,
  inspectSkillArchiveBytes,
} from '~/workers/skill-import'
import {
  buildArchive,
  buildSymlinkArchive,
  forgeCentralSizes,
  markAsZip64,
  skillMarkdown,
  validSkillArchive,
} from '../../setup/helpers/skill-archives'

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function inspect(bytes: Uint8Array) {
  return inspectSkillArchiveBytes({
    name: 'skill.zip',
    bytes: toArrayBuffer(bytes),
  })
}

describe('inspectSkillArchiveBytes', () => {
  it('summarises a valid archive for instant feedback', async () => {
    const result = await inspect(validSkillArchive({
      'scripts/run.sh': 'curl https://example.com\n',
    }))

    expect(result).toMatchObject({
      ok: true,
      summary: {
        name: 'review-pr',
        licenceClass: 'none',
        findingCounts: { url: 1, shell: 1 },
      },
    })

    if (result.ok) {
      expect(result.summary.files.map((file) => {
        return file.path
      })).toEqual(['SKILL.md', 'references/checklist.md', 'scripts/run.sh'])
    }
  })

  it('stops a restricted licence before upload', async () => {
    const old = readFileSync(
      join(process.cwd(), 'tests/fixtures/skills/licences/anthropic-proprietary.txt'),
      'utf8',
    )
    const result = await inspect(validSkillArchive({ 'LICENSE.txt': old }))

    expect(result).toMatchObject({ ok: false, code: 'licence-restricted' })
  })

  it('refuses an archive over 5 MiB compressed', async () => {
    expect(await inspect(new Uint8Array(5 * 1024 * 1024 + 1))).toMatchObject({
      ok: false,
      code: 'archive-too-large',
    })
  })

  it('refuses unreadable and zip64 archives from the directory alone', async () => {
    expect(await inspect(new TextEncoder().encode('not a zip'))).toMatchObject({
      ok: false,
      code: 'archive-invalid',
    })
    expect(await inspect(markAsZip64(validSkillArchive()))).toMatchObject({
      ok: false,
      code: 'archive-invalid',
    })
  })

  it('refuses a forged 1 GB entry before inflating it', async () => {
    const forged = forgeCentralSizes(
      validSkillArchive(),
      'review-pr/references/checklist.md',
      { uncompressed: 1_000_000_000 },
    )

    expect(await inspect(forged)).toMatchObject({
      ok: false,
      code: 'archive-total-too-large',
    })
  })

  it('refuses an entry over 1 MiB and a 100:1 bomb', async () => {
    expect(await inspect(validSkillArchive({
      'references/zeros.md': 'a'.repeat(2 * 1024 * 1024),
    }))).toMatchObject({ ok: false, code: 'archive-entry-too-large' })
    expect(await inspect(validSkillArchive({
      'references/zeros.md': 'a'.repeat(1024 * 1024),
    }))).toMatchObject({ ok: false, code: 'archive-ratio' })
  })

  it('does not reject an archive for its directory entries alone', async () => {
    const entries: Record<string, string | Uint8Array> = {
      'skill/SKILL.md': skillMarkdown(),
    }

    for (let index = 0; index < 150; index += 1) {
      entries[`skill/dir${index}/`] = new Uint8Array(0)
    }

    expect(await inspect(buildArchive(entries))).toMatchObject({ ok: true })
  })

  it.each([
    ['symlink', buildSymlinkArchive()],
    ['zip slip', buildArchive({
      'skill/SKILL.md': skillMarkdown(),
      '../../evil.md': 'x',
    })],
    ['missing SKILL.md', buildArchive({ 'skill/readme.md': 'x' })],
    ['two roots', buildArchive({
      'a/SKILL.md': skillMarkdown({ name: 'a' }),
      'b/SKILL.md': skillMarkdown({ name: 'b' }),
    })],
    ['pyc', validSkillArchive({ 'x.pyc': 'bytes' })],
    ['invalid utf-8', validSkillArchive({
      'n.md': new Uint8Array([0xFF, 0xFE]),
    })],
  ])('rejects %s with the same code as the server rules', async (_name, bytes) => {
    const server = extractSkillArchive(bytes)
    const client = await inspect(bytes)

    expect(server.ok).toBe(false)
    expect(client.ok).toBe(false)
    expect(client.ok === false && client.code).toBe(
      server.ok === false && server.code,
    )
  })
})

describe('handleSkillImportWorkerRequest', () => {
  it('echoes the request id with the result', async () => {
    const response = await handleSkillImportWorkerRequest({
      id: 9,
      name: 'skill.zip',
      bytes: toArrayBuffer(validSkillArchive()),
    })

    expect(response).toMatchObject({ id: 9, ok: true })
  })
})
