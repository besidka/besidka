import { SKILL_NAME_MAX, isSkillNameValid } from '#shared/utils/skills-policy'
import { sha256Hex } from '#shared/utils/knowledge-hash'

export const SKILL_SCRIPTS_FEATURE_KEY = 'skills.scripts'
export const SKILL_SCRIPTS_GATE_TOOL_NAME = 'run_skill_scripts'
export const SKILL_SCRIPTS_GRANT_KEY = 'run_skill_scripts'
export const SKILL_CONTAINER_MAX_SKILLS = 8
export const SKILL_CONTAINER_MAX_BYTES = 30 * 1024 * 1024
export const SKILL_PROVIDER_DISPLAY_TITLE_MAX = 255

export const SKILL_PROVIDER_RESERVED_WORDS = [
  { word: 'anthropic', replacement: 'bsk-a' },
  { word: 'claude', replacement: 'bsk-c' },
] as const

const MAX_RENAME_PASSES = 8
const PROVIDER_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const ENCODED_VERSION_PATTERN = /^(\d{1,9}):([A-Za-z0-9._-]{1,128})$/
const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const NAME_LINE_PATTERN = /^(["']?)name\1[ \t]*:[^\r\n]*$/m

export const SKILL_SCRIPTS_DISCLOSURE_POINTS = [
  'The skill files are uploaded to your own Anthropic workspace and are '
  + 'visible to everyone who works in that workspace.',
  'Agent Skills are not covered by zero data retention. The files stay '
  + 'there until they are deleted, and then follow Anthropic\'s standard '
  + 'retention policy.',
  'Running them uses the code execution tool. Container data is kept for '
  + 'up to 30 days. Container time is billed to your Anthropic '
  + 'organization after the free allowance of 1,550 container-hours a '
  + 'month, then $0.05 an hour with a 5-minute minimum.',
  'Use only skills from sources you trust. A script runs with no internet '
  + 'access, but it can read the files you give the sandbox.',
] as const

export interface ProviderSkillName {
  providerName: string
  isRenamed: boolean
}

export type ProviderSkillNameResult
  = | ({ ok: true } & ProviderSkillName)
    | { ok: false, reason: 'invalid-name' | 'unresolvable' }

export interface EncodedProviderSkillVersion {
  besidkaVersion: number
  providerVersion: string
}

export function containsProviderReservedWord(name: string): boolean {
  const lowered = name.toLowerCase()

  return SKILL_PROVIDER_RESERVED_WORDS.some(({ word }) => {
    return lowered.includes(word)
  })
}

/**
 * Anthropic refuses a skill name that contains `anthropic` or `claude`
 * anywhere, so a prefix does not clear it. Each word is replaced (`claude-api`
 * becomes `bsk-c-api`) until none is left; the name only ever shrinks, so it
 * keeps its length limit.
 */
export function toProviderSkillName(name: string): ProviderSkillNameResult {
  if (!isSkillNameValid(name)) {
    return { ok: false, reason: 'invalid-name' }
  }

  let providerName = name

  for (
    let pass = 0;
    pass < MAX_RENAME_PASSES && containsProviderReservedWord(providerName);
    pass += 1
  ) {
    for (const { word, replacement } of SKILL_PROVIDER_RESERVED_WORDS) {
      providerName = providerName.split(word).join(replacement)
    }
  }

  if (
    containsProviderReservedWord(providerName)
    || providerName.length > SKILL_NAME_MAX
    || !isSkillNameValid(providerName)
  ) {
    return { ok: false, reason: 'unresolvable' }
  }

  return { ok: true, providerName, isRenamed: providerName !== name }
}

export function buildProviderRenameNote(
  originalName: string,
  providerName: string,
): string {
  return `> Changed by Besidka: the skill name \`${originalName}\` was `
    + `changed to \`${providerName}\` for the upload, because the provider `
    + 'does not allow "anthropic" or "claude" in a skill name.'
}

/**
 * Rewrites only the `name:` line of the frontmatter and appends the change
 * note. Returns `null` when the frontmatter has no `name:` line, so the
 * caller fails closed instead of uploading a file the provider would refuse.
 */
export function renameSkillMarkdown(
  skillMarkdown: string,
  originalName: string,
  providerName: string,
): string | null {
  const frontmatter = FRONTMATTER_PATTERN.exec(skillMarkdown)

  if (!frontmatter || frontmatter[1] === undefined) {
    return null
  }

  const block = frontmatter[1]

  if (!NAME_LINE_PATTERN.test(block)) {
    return null
  }

  const renamedBlock = block.replace(NAME_LINE_PATTERN, `name: ${providerName}`)
  const head = skillMarkdown.slice(0, frontmatter.index)
  const tail = skillMarkdown.slice(frontmatter.index + frontmatter[0].length)
  const rebuilt = `---\n${renamedBlock}\n---\n${tail}`

  return `${head}${rebuilt.trimEnd()}\n\n${
    buildProviderRenameNote(originalName, providerName)
  }\n`
}

export function encodeProviderSkillVersion(
  input: EncodedProviderSkillVersion,
): string {
  if (
    !Number.isInteger(input.besidkaVersion)
    || input.besidkaVersion < 0
    || !PROVIDER_VERSION_PATTERN.test(input.providerVersion)
  ) {
    throw new TypeError('Invalid provider skill version')
  }

  return `${input.besidkaVersion}:${input.providerVersion}`
}

export function parseProviderSkillVersion(
  value: string | null | undefined,
): EncodedProviderSkillVersion | null {
  const match = ENCODED_VERSION_PATTERN.exec(value ?? '')

  if (!match || match[1] === undefined || match[2] === undefined) {
    return null
  }

  return {
    besidkaVersion: Number(match[1]),
    providerVersion: match[2],
  }
}

export interface ProviderCopyState {
  providerSkillId: string | null
  providerSkillVersion: string | null
  providerUploadedName: string | null
  providerDeletedAt: Date | null
}

/**
 * A copy is live when an id is stored and it was not deleted. It is current
 * when the Besidka version it was uploaded from is the skill's
 * `current_version`; an unreadable version counts as stale, so the copy is
 * replaced instead of trusted.
 */
export function isProviderCopyLive(state: ProviderCopyState): boolean {
  return state.providerSkillId !== null
    && state.providerSkillId !== ''
    && state.providerDeletedAt === null
}

export function isProviderCopyCurrent(
  state: ProviderCopyState,
  currentVersion: number,
): boolean {
  return isProviderCopyLive(state)
    && parseProviderSkillVersion(state.providerSkillVersion)
      ?.besidkaVersion === currentVersion
}

export function hasSkillScripts(
  files: ReadonlyArray<{ kind: string }>,
): boolean {
  return files.some(file => file.kind === 'script')
}

/**
 * The definition hash of the scripts consent: the sorted skill ids with their
 * current versions. A grant given in a chat matches only this exact set, so a
 * new version of a script, or another skill joining it, asks again.
 */
export async function hashSkillScriptsSet(
  skills: ReadonlyArray<{ id: string, currentVersion: number }>,
): Promise<string> {
  const lines = skills
    .map(skill => `${skill.id}:${skill.currentVersion}`)
    .sort()

  return await sha256Hex(`skill-scripts\n${lines.join('\n')}`)
}

export function buildSkillScriptsApprovalSummary(
  names: readonly string[],
): string {
  const listed = names.slice(0, SKILL_CONTAINER_MAX_SKILLS).join(', ')

  return `Run scripts from ${listed} in Anthropic's container on your key?`
}
