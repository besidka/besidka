import { sha256Hex } from '#shared/utils/knowledge-hash'
import { getSkillBaseName } from '#shared/utils/skills/path'
import type { SkillLicenseClass } from '#shared/utils/skills-policy'

export const SKILL_LICENCE_CLASSIFIER_VERSION = 1

export const ANTHROPIC_PROPRIETARY_LICENCE_SHA256
  = 'aeebbce5340433ffe11573d0dab76f753526b908183d7bb31a5fe551607a2f17'

export const APACHE_2_HEAD_SHA256
  = '7fb46adff9025f553b882b84ce593c37008d1e83019e4fdd6b21f8c800d0c485'

export const APACHE_2_APPENDIX_SHA256
  = '2ffc09392fc52f86820d96de5bb10eac0e93832bb8ed03968aeadc19af15b707'

export const SHORT_LICENCE_BODY_SHA256: Readonly<Record<string, string>> = {
  'MIT': '56959050891f7b737ac4e803051170c7197f02df73d80bd9a78d968e305bf558',
  'BSD-2-Clause':
    'a63ef1112ebbd402f4b08567180951af8e947e407c24ee835882c6ffa65195d0',
  'BSD-3-Clause':
    'e67a28b98bc45809b4963df778c62512492386503bfb2d148039abcf2d3525a7',
  'ISC': 'a2a686418bbdbf37f28aaf01ff3aef45cfe077a641470465923c8c23fcbe08f9',
}

export const SKILL_PERMISSIVE_SPDX_IDS: ReadonlySet<string> = new Set([
  'mit',
  'apache-2.0',
  'bsd-2-clause',
  'bsd-3-clause',
  'isc',
  '0bsd',
  'unlicense',
  'cc0-1.0',
  'zlib',
])

export const SKILL_LICENCE_EXCEPTION_HASHES: ReadonlySet<string> = new Set()

export const ANTHROPIC_RESTRICTED_MESSAGE
  = 'This copy carries Anthropic\'s earlier proprietary licence. Anthropic moved these skills to Apache-2.0 on 2026-11-06. Import the current version, or use the built-in Anthropic skill on your own Anthropic key.'

export const GENERAL_RESTRICTED_MESSAGE
  = 'Its licence limits use to a named service, or forbids copying. Besidka cannot import it.'

export const CUSTOM_LICENCE_MESSAGE
  = 'Custom licence. Read it before you install.'

export const NO_LICENCE_MESSAGE
  = 'No licence stated. The author keeps all rights by default. Besidka keeps a private copy for you only. Install it only if you have the right to use it.'

export const OPEN_LICENCE_MESSAGE = 'Open licence.'

export type SkillImportLicenceClass = Exclude<SkillLicenseClass, 'authored'>

export interface SkillLicenceInputFile {
  path: string
  text: string
}

export interface SkillLicenceInput {
  files: SkillLicenceInputFile[]
  fallbackFiles?: SkillLicenceInputFile[]
  licenseField: string | null
  exceptionHashes?: ReadonlySet<string>
  restrictiveHashes?: ReadonlySet<string>
}

export interface SkillLicenceResult {
  class: SkillImportLicenceClass
  text: string
  matched: string[]
  licenceFile: string | null
  licenceFileSha256: string | null
  licenceText: string | null
  spdx: string | null
  licenseField: string | null
  warnings: string[]
  classifierVersion: number
}

interface LicenceFileVerdict {
  class: SkillImportLicenceClass
  matched: string[]
  spdx: string | null
  sha256: string
  text: string
  isAnthropic: boolean
}

const LICENCE_ENTRY_PATTERN = /^(?:licen[sc]e|copying|notice)(?:\.[A-Za-z0-9_-]{1,16})?$/i
const NOTICE_ENTRY_PATTERN = /^notice(?:\.[A-Za-z0-9_-]{1,16})?$/i
const END_OF_TERMS_MARKER = 'END OF TERMS AND CONDITIONS'
const PARAGRAPH_MAX_CHARACTERS = 2000
const CLASS_STRICTNESS: Record<SkillImportLicenceClass, number> = {
  open: 1,
  none: 2,
  custom: 3,
  restricted: 4,
}

const RESTRICTION_HEADINGS: ReadonlyArray<{ name: string, pattern: RegExp }> = [
  { name: 'additional-restrictions', pattern: /ADDITIONAL RESTRICTIONS/ },
  {
    name: 'notwithstanding-agreement',
    pattern: /Notwithstanding anything in the Agreement/i,
  },
]

const ALL_RIGHTS_RESERVED_PATTERN = /\ball rights reserved\b/i
const FORBIDDING_PATTERN
  = /\b(?:may not|must not|shall not|cannot|not permitted|prohibited|forbidden)\b/i
const FORBIDDEN_OBJECT_PATTERN
  = /\b(?:copy|copies|copying|reproduc\w*|derivative works?|distribut\w*|sublicens\w*|transfer\w*|extract\w*)\b/i
const SERVICE_LIMIT_PATTERN
  = /\b(?:only (?:within|inside)|inside the services?|within the services?)\b/i
const NON_COMMERCIAL_PATTERN = /non-?\s?commercial/i
const PROPRIETARY_FIELD_PATTERN
  = /^\s*(?:proprietary|all rights reserved)\b/i
const COPYRIGHT_LINE_PATTERN = /^\s*(?:copyright\b|\(c\)|©)/i
const ALL_RIGHTS_LINE_PATTERN = /^\s*all rights reserved\.?\s*$/i
const TITLE_LINE_PATTERN
  = /^\s*(?:the\s+)?(?:mit|isc|bsd(?:[ -]?\d(?:-clause)?)?(?:[ -]clause)?)\s+licen[sc]e(?:\s*\(.*\))?\s*$/i

export function normaliseLicenceText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

export function isSkillLicenceEntry(path: string): boolean {
  return LICENCE_ENTRY_PATTERN.test(getSkillBaseName(path))
}

function isNoticeEntry(path: string): boolean {
  return NOTICE_ENTRY_PATTERN.test(getSkillBaseName(path))
}

/**
 * Masks the copyright line and the title, then collapses whitespace, so the
 * wrapping of an SPDX text and of a real file compare equal.
 */
export function normaliseLicenceBody(text: string): string {
  return normaliseLicenceText(text)
    .split('\n')
    .filter((line) => {
      return !COPYRIGHT_LINE_PATTERN.test(line)
        && !ALL_RIGHTS_LINE_PATTERN.test(line)
        && !TITLE_LINE_PATTERN.test(line)
    })
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function findRestrictionPhrase(text: string): string | null {
  for (const { name, pattern } of RESTRICTION_HEADINGS) {
    if (pattern.test(text)) {
      return name
    }
  }

  if (!ALL_RIGHTS_RESERVED_PATTERN.test(text)) {
    return null
  }

  const paragraphs = text.split(/\n\s*\n/)

  for (const paragraph of paragraphs) {
    const bounded = paragraph.slice(0, PARAGRAPH_MAX_CHARACTERS)

    if (
      FORBIDDING_PATTERN.test(bounded) && FORBIDDEN_OBJECT_PATTERN.test(bounded)
    ) {
      return 'all-rights-reserved-forbids-use'
    }

    if (SERVICE_LIMIT_PATTERN.test(bounded)) {
      return 'all-rights-reserved-service-limit'
    }
  }

  return null
}

async function isApache2(text: string): Promise<boolean> {
  const markerIndex = text.indexOf(END_OF_TERMS_MARKER)

  if (markerIndex < 0) {
    return false
  }

  const head = text.slice(0, markerIndex).trim()

  if (await sha256Hex(head) !== APACHE_2_HEAD_SHA256) {
    return false
  }

  const tail = text.slice(markerIndex + END_OF_TERMS_MARKER.length).trim()

  if (tail === '') {
    return true
  }

  const lines = tail.split('\n')
  const copyrightLines = lines.filter((line) => {
    return /^\s*Copyright\s/.test(line)
  })

  if (copyrightLines.length !== 1) {
    return false
  }

  const masked = lines.map((line) => {
    return /^\s*Copyright\s/.test(line) ? 'Copyright' : line
  }).join('\n')

  return await sha256Hex(masked) === APACHE_2_APPENDIX_SHA256
}

async function findShortOpenLicence(text: string): Promise<string | null> {
  const bodyHash = await sha256Hex(normaliseLicenceBody(text))

  for (const [spdx, hash] of Object.entries(SHORT_LICENCE_BODY_SHA256)) {
    if (hash === bodyHash) {
      return spdx
    }
  }

  return null
}

async function classifyLicenceFile(
  file: SkillLicenceInputFile,
  input: SkillLicenceInput,
): Promise<LicenceFileVerdict> {
  const text = normaliseLicenceText(file.text)
  const sha256 = await sha256Hex(text)
  const verdict = (
    licenceClass: SkillImportLicenceClass,
    matched: string[],
    spdx: string | null = null,
    isAnthropic = false,
  ): LicenceFileVerdict => {
    return { class: licenceClass, matched, spdx, sha256, text, isAnthropic }
  }
  const isException = (input.exceptionHashes ?? SKILL_LICENCE_EXCEPTION_HASHES)
    .has(sha256)
  const restrictiveHashes = input.restrictiveHashes
    ?? new Set([ANTHROPIC_PROPRIETARY_LICENCE_SHA256])

  if (!isException) {
    if (restrictiveHashes.has(sha256)) {
      return verdict(
        'restricted',
        ['known-restrictive-text'],
        null,
        sha256 === ANTHROPIC_PROPRIETARY_LICENCE_SHA256,
      )
    }

    const phrase = findRestrictionPhrase(text)

    if (phrase) {
      return verdict(
        'restricted',
        [`restriction-phrase:${phrase}`],
        null,
        /anthropic/i.test(text),
      )
    }
  }

  if (await isApache2(text)) {
    return verdict('open', ['apache-2.0'], 'Apache-2.0')
  }

  const shortSpdx = await findShortOpenLicence(text)

  if (shortSpdx) {
    return verdict('open', [shortSpdx.toLowerCase()], shortSpdx)
  }

  return verdict('custom', ['unrecognised-licence-file'])
}

function pickStricter(
  current: LicenceFileVerdict | null,
  candidate: LicenceFileVerdict,
): LicenceFileVerdict {
  if (!current) {
    return candidate
  }

  return CLASS_STRICTNESS[candidate.class] > CLASS_STRICTNESS[current.class]
    ? candidate
    : current
}

function resolveLicenceFiles(
  files: SkillLicenceInputFile[],
  fallbackFiles: SkillLicenceInputFile[] | undefined,
): SkillLicenceInputFile[] {
  const inFolder = files.filter((file) => {
    return !file.path.includes('/') && isSkillLicenceEntry(file.path)
  })

  if (inFolder.length > 0) {
    return inFolder
  }

  return (fallbackFiles ?? []).filter((file) => {
    return !file.path.includes('/') && isSkillLicenceEntry(file.path)
  })
}

function messageFor(
  licenceClass: SkillImportLicenceClass,
  isAnthropic: boolean,
): string {
  switch (licenceClass) {
    case 'restricted':
      return isAnthropic
        ? ANTHROPIC_RESTRICTED_MESSAGE
        : GENERAL_RESTRICTED_MESSAGE
    case 'custom':
      return CUSTOM_LICENCE_MESSAGE
    case 'none':
      return NO_LICENCE_MESSAGE
    default:
      return OPEN_LICENCE_MESSAGE
  }
}

interface FieldVerdict {
  class: SkillImportLicenceClass
  matched: string
  spdx: string | null
}

function classifyField(field: string | null): FieldVerdict | null {
  if (!field || field.trim() === '') {
    return null
  }

  if (PROPRIETARY_FIELD_PATTERN.test(field)) {
    return { class: 'restricted', matched: 'field-proprietary', spdx: null }
  }

  if (SKILL_PERMISSIVE_SPDX_IDS.has(field.trim().toLowerCase())) {
    return { class: 'open', matched: 'field-only', spdx: field.trim() }
  }

  return { class: 'custom', matched: 'field-custom', spdx: null }
}

/**
 * The nine-step gate of docs/skills.md section 4. The licence file decides;
 * the `license` field is read only when there is no file, and it can only
 * tighten a file-based result, never loosen it. `authored` is never returned:
 * it belongs to the editor and templates, not to an import.
 */
export async function classifySkillLicence(
  input: SkillLicenceInput,
): Promise<SkillLicenceResult> {
  const licenceFiles = resolveLicenceFiles(input.files, input.fallbackFiles)
  const warnings: string[] = []
  const field = input.licenseField?.trim() || null
  const base = {
    licenseField: field,
    warnings,
    classifierVersion: SKILL_LICENCE_CLASSIFIER_VERSION,
  }

  if (licenceFiles.length === 0) {
    const fieldVerdict = classifyField(field)

    if (fieldVerdict) {
      return {
        ...base,
        class: fieldVerdict.class,
        text: messageFor(fieldVerdict.class, false),
        matched: [fieldVerdict.matched],
        licenceFile: null,
        licenceFileSha256: null,
        licenceText: null,
        spdx: fieldVerdict.spdx,
      }
    }

    return {
      ...base,
      class: 'none',
      text: messageFor('none', false),
      matched: ['no-licence'],
      licenceFile: null,
      licenceFileSha256: null,
      licenceText: null,
      spdx: null,
    }
  }

  const hasMainLicence = licenceFiles.some((file) => {
    return !isNoticeEntry(file.path)
  })
  let strongest: LicenceFileVerdict | null = null
  let strongestPath: string | null = null

  for (const file of licenceFiles) {
    const verdict = await classifyLicenceFile(file, input)
    const isIgnorableNotice = isNoticeEntry(file.path)
      && hasMainLicence
      && verdict.class !== 'restricted'

    if (NON_COMMERCIAL_PATTERN.test(verdict.text)) {
      warnings.push(`${file.path} mentions a non-commercial term`)
    }

    if (isIgnorableNotice) {
      continue
    }

    const next = pickStricter(strongest, verdict)

    if (next === verdict) {
      strongestPath = file.path
    }

    strongest = next
  }

  const decided = strongest!
  const matched = [...decided.matched]
  let finalClass = decided.class

  const fieldVerdict = classifyField(field)

  if (fieldVerdict) {
    if (decided.class === 'open' && fieldVerdict.class === 'restricted') {
      finalClass = 'custom'
      matched.push('field-disagrees-with-file')
    } else if (decided.class === 'restricted' && fieldVerdict.class === 'open') {
      matched.push('field-names-open-licence')
    }
  }

  return {
    ...base,
    class: finalClass,
    text: messageFor(finalClass, decided.isAnthropic),
    matched,
    licenceFile: strongestPath,
    licenceFileSha256: decided.sha256,
    licenceText: decided.text,
    spdx: decided.spdx,
  }
}
