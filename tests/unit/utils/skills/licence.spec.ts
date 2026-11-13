import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ANTHROPIC_PROPRIETARY_LICENCE_SHA256,
  ANTHROPIC_RESTRICTED_MESSAGE,
  GENERAL_RESTRICTED_MESSAGE,
  classifySkillLicence,
  normaliseLicenceText,
} from '#shared/utils/skills/licence'

const FIXTURES = join(process.cwd(), 'tests/fixtures/skills/licences')

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

const anthropicOld = fixture('anthropic-proprietary.txt')
const apache = fixture('apache-2.0.txt')
const mit = fixture('mit.txt').replace(
  'Copyright (c) <year> <copyright holders>',
  'Copyright (c) 2024 Jane Doe',
)

function classify(
  files: Array<[string, string]>,
  licenseField: string | null = null,
  extra: Partial<Parameters<typeof classifySkillLicence>[0]> = {},
) {
  return classifySkillLicence({
    files: files.map(([path, text]) => {
      return { path, text }
    }),
    licenseField,
    ...extra,
  })
}

describe('classifySkillLicence: restricted', () => {
  it('blocks the old Anthropic text by hash with the Anthropic message', async () => {
    const hash = createHash('sha256')
      .update(normaliseLicenceText(anthropicOld))
      .digest('hex')

    expect(hash).toBe(ANTHROPIC_PROPRIETARY_LICENCE_SHA256)

    const result = await classify([['LICENSE.txt', anthropicOld]])

    expect(result).toMatchObject({
      class: 'restricted',
      matched: ['known-restrictive-text'],
      text: ANTHROPIC_RESTRICTED_MESSAGE,
      licenceFile: 'LICENSE.txt',
    })
  })

  it('blocks the same text with CRLF line endings and trailing space', async () => {
    const result = await classify([
      ['LICENSE.txt', `${anthropicOld.replace(/\n/g, '\r\n')}\r\n\r\n`],
    ])

    expect(result.class).toBe('restricted')
    expect(result.matched).toEqual(['known-restrictive-text'])
  })

  it('blocks an edited copy by its restriction phrases', async () => {
    const edited = anthropicOld.replace('2025', '2026').concat('\nExtra line.')
    const result = await classify([['LICENSE.txt', edited]])

    expect(result.class).toBe('restricted')
    expect(result.matched).toEqual([
      'restriction-phrase:additional-restrictions',
    ])
    expect(result.text).toBe(ANTHROPIC_RESTRICTED_MESSAGE)
  })

  it('blocks an Apache header with restrictions appended', async () => {
    const result = await classify([
      [
        'LICENSE',
        `${apache}\n\nADDITIONAL RESTRICTIONS: you may not copy this.\n`,
      ],
    ])

    expect(result.class).toBe('restricted')
    expect(result.text).toBe(GENERAL_RESTRICTED_MESSAGE)
  })

  it('blocks "all rights reserved" that forbids copying', async () => {
    const result = await classify([
      [
        'LICENSE',
        'All rights reserved.\n\nYou may not copy, reproduce or distribute this skill.',
      ],
    ])

    expect(result).toMatchObject({
      class: 'restricted',
      matched: ['restriction-phrase:all-rights-reserved-forbids-use'],
      text: GENERAL_RESTRICTED_MESSAGE,
    })
  })

  it('blocks "all rights reserved" that limits use to a named service', async () => {
    const result = await classify([
      [
        'LICENSE',
        'All rights reserved.\n\nThese files may be used only within the Acme Services.',
      ],
    ])

    expect(result.class).toBe('restricted')
  })

  it('does not block prose that only mentions additional restrictions', async () => {
    const result = await classify([
      ['LICENSE', 'Use it freely. There are no additional restrictions.'],
    ])

    expect(result.class).toBe('custom')
  })

  it('does not block "all rights reserved" on its own', async () => {
    const result = await classify([
      ['LICENSE', 'Copyright 2026 Someone. All rights reserved.\n\nUse freely.'],
    ])

    expect(result.class).toBe('custom')
  })

  it('releases a false positive through the exception list', async () => {
    const text = 'All rights reserved.\n\nYou may not copy this without credit.'
    const hash = createHash('sha256')
      .update(normaliseLicenceText(text))
      .digest('hex')
    const blocked = await classify([['LICENSE', text]])
    const released = await classify([['LICENSE', text]], null, {
      exceptionHashes: new Set([hash]),
    })

    expect(blocked.class).toBe('restricted')
    expect(released.class).toBe('custom')
  })

  it('lets the owner add a restrictive hash', async () => {
    const text = 'A perfectly custom licence.'
    const hash = createHash('sha256').update(text).digest('hex')
    const result = await classify([['LICENSE', text]], null, {
      restrictiveHashes: new Set([hash]),
    })

    expect(result.class).toBe('restricted')
  })

  it('treats a proprietary field with no file as restricted', async () => {
    const result = await classify([], 'Proprietary')

    expect(result).toMatchObject({
      class: 'restricted',
      matched: ['field-proprietary'],
    })
    expect((await classify([], 'All rights reserved')).class).toBe('restricted')
  })

  it('lets an open field never rescue a restricted file', async () => {
    const result = await classify([['LICENSE.txt', anthropicOld]], 'MIT')

    expect(result.class).toBe('restricted')
    expect(result.matched).toEqual([
      'known-restrictive-text',
      'field-names-open-licence',
    ])
  })
})

describe('classifySkillLicence: open', () => {
  it('recognises Apache-2.0 with the appendix unfilled', async () => {
    const result = await classify([['LICENSE.txt', apache]])

    expect(Buffer.byteLength(apache)).toBe(11357)
    expect(result).toMatchObject({
      class: 'open',
      spdx: 'Apache-2.0',
      matched: ['apache-2.0'],
      licenceFile: 'LICENSE.txt',
    })
  })

  it('recognises Apache-2.0 with one filled copyright line', async () => {
    const filled = apache.replace(
      '[yyyy] [name of copyright owner]',
      '2026 Anthropic, PBC.',
    )

    expect(Buffer.byteLength(filled)).toBe(11345)
    expect((await classify([['LICENSE.txt', filled]])).class).toBe('open')
  })

  it('recognises Apache-2.0 without an appendix', async () => {
    const marker = 'END OF TERMS AND CONDITIONS'
    const headOnly = `${apache.slice(0, apache.indexOf(marker) + marker.length)}\n`

    expect(Buffer.byteLength(headOnly)).toBe(10174)
    expect((await classify([['LICENSE.txt', headOnly]])).class).toBe('open')
  })

  it('does not match Apache with two copyright lines or another tail', async () => {
    const twoLines = apache.replace(
      'Copyright [yyyy] [name of copyright owner]',
      'Copyright 2026 A\n   Copyright 2027 B',
    )
    const otherTail = `${apache}\nYou also agree to pay the author.`

    expect((await classify([['LICENSE', twoLines]])).class).toBe('custom')
    expect((await classify([['LICENSE', otherTail]])).class).toBe('custom')
  })

  it.each([
    ['mit.txt', 'MIT'],
    ['bsd-2-clause.txt', 'BSD-2-Clause'],
    ['bsd-3-clause.txt', 'BSD-3-Clause'],
    ['isc.txt', 'ISC'],
  ])('recognises %s whatever its copyright line and wrapping', async (name, spdx) => {
    const text = fixture(name)
      .replace(/<year> <(?:copyright holders|owner)>/, '2024 Jane Doe')
      .replace(/<year> <owner>/, '2024 Jane Doe')
    const rewrapped = text.replace(/\n(?!\n)/g, ' ').replace(/\. /g, '.\n')
    const result = await classify([['LICENSE', rewrapped.replace(/\n/g, '\r\n')]])

    expect(result).toMatchObject({ class: 'open', spdx })
  })

  it('accepts MIT with a title and "All rights reserved" in the copyright line', async () => {
    const result = await classify([
      [
        'LICENSE',
        `The MIT License (MIT)\n\n${mit.replace(
          'Copyright (c) 2024 Jane Doe',
          'Copyright (c) 2024 Jane Doe. All rights reserved.',
        )}`,
      ],
    ])

    expect(result.class).toBe('open')
  })

  it('ignores a NOTICE file next to an open LICENSE', async () => {
    const result = await classify([
      ['LICENSE', apache],
      ['NOTICE', 'This product includes software by Example Corp.'],
    ])

    expect(result.class).toBe('open')
    expect(result.licenceFile).toBe('LICENSE')
  })

  it('names an open licence with no file, as the design says', async () => {
    const result = await classify([], 'Apache-2.0')

    expect(result).toMatchObject({
      class: 'open',
      matched: ['field-only'],
      licenceFile: null,
    })
  })

  it('never lets the field upgrade what the file decided', async () => {
    const result = await classify([['LICENSE', 'Some custom terms.']], 'MIT')

    expect(result.class).toBe('custom')
  })
})

describe('classifySkillLicence: custom and none', () => {
  it('classes a licence file that matched nothing as custom', async () => {
    const result = await classify([['LICENSE.md', 'Use it for good.']])

    expect(result).toMatchObject({
      class: 'custom',
      matched: ['unrecognised-licence-file'],
    })
  })

  it('classes a NOTICE file on its own as custom', async () => {
    expect((await classify([['NOTICE', 'Notice text']])).class).toBe('custom')
  })

  it('classes an unrecognised field with no file as custom', async () => {
    expect((await classify([], 'See the website')).class).toBe('custom')
  })

  it('shows both when an open file disagrees with a proprietary field', async () => {
    const result = await classify([['LICENSE', apache]], 'Proprietary')

    expect(result).toMatchObject({
      class: 'custom',
      matched: ['apache-2.0', 'field-disagrees-with-file'],
      licenseField: 'Proprietary',
    })
  })

  it('returns none when there is nothing at all', async () => {
    const result = await classify([['SKILL.md', 'text']])

    expect(result).toMatchObject({
      class: 'none',
      matched: ['no-licence'],
      licenceFile: null,
      licenceFileSha256: null,
    })
  })

  it('reads the repository root only when the folder has no licence file', async () => {
    const fromRoot = await classify([['SKILL.md', 'x']], null, {
      fallbackFiles: [{ path: 'LICENSE', text: mit }],
    })
    const folderWins = await classify([['LICENSE', 'Custom terms']], null, {
      fallbackFiles: [{ path: 'LICENSE', text: mit }],
    })

    expect(fromRoot.class).toBe('open')
    expect(folderWins.class).toBe('custom')
  })

  it('ignores licence files in sub-folders', async () => {
    const result = await classify([['scripts/vendor/LICENSE', mit]])

    expect(result.class).toBe('none')
  })

  it('warns about a non-commercial term', async () => {
    const result = await classify([
      ['LICENSE', 'Creative Commons Attribution-NonCommercial 4.0'],
    ])

    expect(result.warnings).toEqual(['LICENSE mentions a non-commercial term'])
  })

  it('never returns authored', async () => {
    const classes = new Set<string>()

    for (const files of [[], [['LICENSE', mit]], [['LICENSE', 'x']]] as Array<
      Array<[string, string]>
    >) {
      classes.add((await classify(files)).class)
    }

    expect(classes.has('authored')).toBe(false)
  })
})
