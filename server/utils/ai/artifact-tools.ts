import type { ToolSet } from 'ai'
import type { ArtifactKind, ArtifactVersionCreatedBy } from '#shared/utils/artifacts'
import type { BlobStore } from '~~/server/utils/platform/types'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { tool } from 'ai'
import { createError } from 'evlog'
import { z } from 'zod'
import {
  ARTIFACT_MAX_VERSIONS,
  ARTIFACT_TITLE_MAX,
  ARTIFACT_VERSION_MAX_BYTES,
} from '#shared/utils/artifacts'
import { withFollowUpTurn } from '~~/server/utils/ai/tool-loop'
import {
  ARTIFACT_ERROR_CODES,
  appendArtifactVersion,
  createArtifact,
  readArtifactVersion,
} from '~~/server/utils/artifacts/store'
import {
  CREATE_ARTIFACT_TOOL_NAME,
  UPDATE_ARTIFACT_TOOL_NAME,
} from '~~/server/utils/artifacts/message-parts'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

type DbClient = ReturnType<typeof useDb>

export const ARTIFACT_WRITES_PER_TURN = 3
export const ARTIFACT_EDIT_READS_PER_TURN = 6
export const ARTIFACT_EDITS_MAX = 20

export const ARTIFACT_TOOL_ERROR_CODES = {
  tooLarge: 'artifact-too-large',
  quota: 'artifact-quota',
  versionCap: 'artifact-version-cap',
  versionConflict: 'artifact-version-conflict',
  editMismatch: 'artifact-edit-mismatch',
  unknown: 'artifact-unknown',
  invalidInput: 'artifact-invalid-input',
  turnLimit: 'artifact-turn-limit',
  writeFailed: 'artifact-write-failed',
} as const

const STORE_TO_TOOL_ERROR_CODES: Record<string, string> = {
  [ARTIFACT_ERROR_CODES.tooLarge]: ARTIFACT_TOOL_ERROR_CODES.tooLarge,
  [ARTIFACT_ERROR_CODES.quotaExceeded]: ARTIFACT_TOOL_ERROR_CODES.quota,
  [ARTIFACT_ERROR_CODES.versionCap]: ARTIFACT_TOOL_ERROR_CODES.versionCap,
  [ARTIFACT_ERROR_CODES.versionConflict]:
    ARTIFACT_TOOL_ERROR_CODES.versionConflict,
  [ARTIFACT_ERROR_CODES.notFound]: ARTIFACT_TOOL_ERROR_CODES.unknown,
  [ARTIFACT_ERROR_CODES.takenDown]: ARTIFACT_TOOL_ERROR_CODES.unknown,
  [ARTIFACT_ERROR_CODES.contentMissing]: ARTIFACT_TOOL_ERROR_CODES.unknown,
  [ARTIFACT_ERROR_CODES.invalidInput]: ARTIFACT_TOOL_ERROR_CODES.invalidInput,
}

export interface ArtifactEdit {
  old_string: string
  new_string: string
}

export interface CreateArtifactToolsInput {
  db: DbClient
  storage: BlobStore
  userId: number
  chatId: string
  messageId: string
  allowedKinds: readonly ArtifactKind[]
  chatArtifactIds: readonly string[]
  modelId?: string | null
  createdBy?: ArtifactVersionCreatedBy
  logger: LoggerLike
}

interface ArtifactToolError extends Error {
  code?: string
  why?: string
  fix?: string
}

function createToolError(code: string, message: string, why?: string) {
  return createError({
    message,
    status: 400,
    code,
    why: why ?? message,
  })
}

function toToolError(exception: unknown): Error {
  const error = exception as ArtifactToolError
  const toolCode = error?.code
    ? STORE_TO_TOOL_ERROR_CODES[error.code]
    : undefined

  if (toolCode) {
    const why = error.why && error.why !== error.message
      ? ` ${error.why}.`
      : ''
    const fix = error.fix ? ` ${error.fix}.` : ''

    return createToolError(
      toolCode,
      `${error.message}.${why}${fix}`,
      error.why,
    )
  }

  if (error?.code && Object.values<string>(ARTIFACT_TOOL_ERROR_CODES)
    .includes(error.code)) {
    return error
  }

  return createToolError(
    ARTIFACT_TOOL_ERROR_CODES.writeFailed,
    'The artifact could not be saved. Tell the user to try again later.',
  )
}

function countOccurrences(content: string, search: string): number {
  let count = 0
  let position = content.indexOf(search)

  while (position !== -1 && count < 2) {
    count += 1
    position = content.indexOf(search, position + 1)
  }

  return count
}

/**
 * Applies exact-match edits in order. Each `old_string` must occur exactly
 * once in the content as it is when that edit runs; zero or several matches
 * throw an `artifact-edit-mismatch` error that names the 1-based edit index,
 * and nothing is written. Shared with the MCP `update_artifact` tool (A-8).
 */
export function applyArtifactEdits(
  content: string,
  edits: readonly ArtifactEdit[],
): string {
  let current = content

  edits.forEach((edit, index) => {
    const matches = countOccurrences(current, edit.old_string)

    if (matches !== 1) {
      const problem = matches === 0
        ? 'does not occur in the artifact'
        : 'occurs more than once in the artifact'

      throw createToolError(
        ARTIFACT_TOOL_ERROR_CODES.editMismatch,
        `Edit ${index + 1} failed: old_string ${problem}. No change was `
        + 'saved. Copy old_string exactly from the current content and '
        + 'include enough surrounding text to make it unique.',
      )
    }

    const start = current.indexOf(edit.old_string)

    current = current.slice(0, start)
      + edit.new_string
      + current.slice(start + edit.old_string.length)
  })

  return current
}

export function buildArtifactKindsDescription(
  allowedKinds: readonly ArtifactKind[],
): string {
  const descriptions: Record<ArtifactKind, string> = {
    html: 'html: one self-contained HTML document with inline JS, styled '
      + 'with daisyUI and Tailwind classes',
    react: 'react: one JSX module whose default export is a React component',
    svg: 'svg: one SVG image',
    mermaid: 'mermaid: one Mermaid diagram',
    markdown: 'markdown: a Markdown document',
  }

  return allowedKinds.map((kind) => {
    return descriptions[kind]
  }).join('; ')
}

const CODE_BLOCK_KINDS: readonly ArtifactKind[] = ['html', 'react', 'markdown']

/**
 * One sentence on the runtime's chat-style code and diagram blocks, only
 * when a kind that can hold them is allowed. HTML needs `<` and `&` escaped
 * inside the elements, the most likely model mistake.
 */
export function buildArtifactCodeBlocksDescription(
  allowedKinds: readonly ArtifactKind[],
): string {
  const hasCodeBlockKind = allowedKinds.some((kind) => {
    return CODE_BLOCK_KINDS.includes(kind)
  })

  if (!hasCodeBlockKind) {
    return ''
  }

  return 'Code and diagrams render like chat (highlighting, Copy, '
    + 'Fullscreen): fenced code and ```mermaid in markdown and '
    + '<pre><code class="language-ts"> in html upgrade automatically '
    + '(data-besidka-raw opts out); otherwise use '
    + '<besidka-code lang="ts">source</besidka-code> and '
    + '<besidka-mermaid>source</besidka-mermaid>, in JSX with the source '
    + 'as a string child, in html with < and & escaped.'
}

const DESIGN_SYSTEM_KINDS: readonly ArtifactKind[] = ['html', 'react']

export const ARTIFACT_DESIGN_INSTRUCTIONS = [
  'Design: html and react artifacts already load Tailwind CSS 4 and',
  'daisyUI 5 with the Besidka theme and the Nunito font. Never link or',
  'import them (no CDN, no external fonts or icons) and do not set',
  'font-family. Style with class names (className in JSX), not CSS:',
  'daisyUI components first, Tailwind utilities for layout and spacing',
  '(flex, grid, gap-4, p-6, max-w-2xl mx-auto, sm:/md: prefixes);',
  'arbitrary values such as w-[18rem] work, and classes that scripts or',
  'React state add later work too.',
  'Colours: only theme names, so light and dark follow the viewer:',
  'primary, secondary, accent, neutral (fills only), base-100 (page,',
  'cards), base-200 and base-300 (sections, borders), base-content (text,',
  'e.g. text-base-content/70 for muted), info, success, warning, error,',
  'and *-content for text on a coloured fill. No fixed colours',
  '(text-gray-700, bg-white, hex) except data colours in charts; no dark:',
  'variants, no theme switcher, no body background.',
  'Components (parts; modifiers): btn (btn-primary, btn-accent, btn-ghost,',
  'btn-outline, btn-soft, btn-sm, btn-lg, btn-block, btn-circle); card',
  '(card-body, card-title, card-actions; card-border); alert',
  '(alert-info/success/warning/error, alert-soft); badge (badge-soft,',
  'badge-outline, colours); progress (progress-accent); radial-progress',
  '(style --value); input, textarea, select, checkbox, radio, toggle,',
  'range; fieldset with fieldset-legend and label; tabs (tabs-box; tab,',
  'tab-active); collapse (collapse-title, collapse-content,',
  'collapse-arrow); join and join-item; menu; navbar; modal (<dialog',
  'class="modal"> with modal-box and modal-action, open with showModal());',
  'table (table-zebra); stats (stat, stat-title, stat-value, stat-desc);',
  'steps (step, step-accent); timeline; countdown; kbd; loading',
  '(loading-spinner); tooltip (data-tip); divider; list and list-row;',
  'hero; swap; rating; avatar; skeleton; toast; indicator; chat',
  '(chat-bubble).',
  'Example: <div class="card bg-base-100 border border-base-300"><div',
  'class="card-body"><h2 class="card-title">Question 1</h2><button',
  'class="btn btn-outline justify-start">Answer</button><div',
  'class="card-actions justify-end"><button class="btn btn-primary">Next',
  '</button></div></div></div>. Give an html body padding (class="p-4");',
  'a React component already sits in a padded page.',
  'Write custom CSS only for what classes cannot do (keyframes, exact',
  'chart sizes), in one short <style> block; it overrides the classes.',
  'Keep it accessible: real <button> and <label> elements, aria-label on',
  'icon-only buttons, text on fills with the matching *-content colour.',
].join(' ')

/**
 * The compact design-system sheet (daisyUI 5 + Tailwind 4, Besidka theme),
 * only when a kind that loads it (html, react) is allowed. Its token cost
 * per provider is recorded in docs/artifacts.md "Design system in
 * artifacts".
 */
export function buildArtifactDesignInstructions(
  allowedKinds: readonly ArtifactKind[],
): string {
  const loadsDesignSystem = allowedKinds.some((kind) => {
    return DESIGN_SYSTEM_KINDS.includes(kind)
  })

  return loadsDesignSystem ? ARTIFACT_DESIGN_INSTRUCTIONS : ''
}

export const ARTIFACT_REACT_IMPORTS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'recharts',
  'lucide-react',
] as const

export interface ArtifactRuntimeFeatures {
  storage: boolean
  modelBridge: boolean
}

/**
 * The system-prompt block that tells the model when and how to use the
 * artifact tools. It depends only on the allowed kinds and the runtime
 * features the user has, so it stays inside the cached prefix.
 */
export function buildArtifactInstructions(
  allowedKinds: readonly ArtifactKind[],
  runtimeFeatures: ArtifactRuntimeFeatures,
): string {
  return [
    'Artifacts are available through `create_artifact` and',
    '`update_artifact`. Create one only when the user asks for an',
    'artifact, an app, an interactive page, a quiz, flashcards, a game or a',
    'dashboard, or for a standalone document (study guide, report, cheat',
    'sheet) or an SVG image to keep, download or share. Everything else',
    'goes in the reply: a diagram as a fenced ```mermaid block (chat',
    'renders it with zoom and export) and code of any length (functions,',
    'scripts, config) as fenced code blocks, unless the user asks for an',
    'artifact or a runnable page.',
    `Allowed kinds: ${buildArtifactKindsDescription(allowedKinds)}.`,
    'Artifacts run in a sandbox without network access: no fetch, no',
    'remote scripts, styles, fonts or images (use inline SVG or data URIs),',
    'no navigation or redirects, and no forms that ask for passwords,',
    'payment details or other personal data.',
    'When the user asks to load data from an API or a website, write',
    'representative data into the artifact instead and say in the reply',
    'that artifacts cannot load live data; leave fetch and API code out',
    'of the artifact, comments included. A plain <a href> link is fine:',
    'the viewer confirms before it opens.',
    'Create one artifact per request unless the user asks for several,',
    'and never an empty or placeholder artifact.',
    allowedKinds.includes('react')
      ? 'React artifacts may import only '
      + `${ARTIFACT_REACT_IMPORTS.join(', ')}; any other import fails.`
      : '',
    runtimeFeatures.storage
      ? 'To keep data between visits use `window.besidka.storage`'
      + ' (async get/set/delete/list; keys of letters, digits and . _ : -,'
      + ' at most 64 keys, 32 KB per value, 100 KB in total).'
      : 'Artifacts cannot keep data between visits.',
    runtimeFeatures.modelBridge
      ? 'Call `window.besidka.complete(prompt, { system, maxOutputTokens })`'
      + ' only when the user asked for AI inside the artifact. The viewer'
      + ' confirms each call and may decline, so catch errors and show a'
      + ' short message.'
      : 'Artifacts cannot call a model.',
    'When the user refers to an artifact from this chat, change it with',
    '`update_artifact` and its id; prefer small `edits` over sending the',
    'whole content again. A new, unrelated request is not an edit.',
    'After writing an artifact, add one or two sentences for the user;',
    'never repeat its source or content in the reply, fenced or not.',
    buildArtifactDesignInstructions(allowedKinds),
  ].filter(Boolean).join(' ')
}

/**
 * Builds the `create_artifact` and `update_artifact` chat tools. Each write
 * goes through the artifact store as a new immutable version, at most
 * `ARTIFACT_WRITES_PER_TURN` per send. `update_artifact` only reaches
 * artifacts created in this chat (`chatArtifactIds`: owned rows whose
 * origin is this chat) or in this turn, never one that a copied or branched
 * message merely references, so a shared chat cannot steer a model into
 * overwriting the reader's own artifacts. An edit is applied to the version
 * it read and refused if a newer one appeared meanwhile. Errors are thrown
 * as tool errors with a readable message the model can relay.
 */
export function createArtifactTools(input: CreateArtifactToolsInput): ToolSet {
  const knownArtifactIds = new Set(input.chatArtifactIds)
  const createdBy = input.createdBy ?? 'model'
  let writes = 0
  let editReads = 0

  function claimEditRead() {
    if (editReads >= ARTIFACT_EDIT_READS_PER_TURN) {
      throw createToolError(
        ARTIFACT_TOOL_ERROR_CODES.turnLimit,
        'Too many artifact edits in this reply. Finish the reply and let '
        + 'the user ask for more changes.',
      )
    }

    editReads += 1
  }

  function claimWrite() {
    if (writes >= ARTIFACT_WRITES_PER_TURN) {
      throw createToolError(
        ARTIFACT_TOOL_ERROR_CODES.turnLimit,
        `At most ${ARTIFACT_WRITES_PER_TURN} artifact writes are allowed per `
        + 'reply. Finish the reply and let the user ask for more changes.',
      )
    }

    writes += 1
  }

  function logWrite(fields: Record<string, unknown>) {
    input.logger.set({ attributes: { artifacts: fields } })
  }

  const kindSchema = z.enum(
    input.allowedKinds as [ArtifactKind, ...ArtifactKind[]],
  )
  const titleSchema = z.string().min(1).max(ARTIFACT_TITLE_MAX)

  return {
    [CREATE_ARTIFACT_TOOL_NAME]: withFollowUpTurn(tool({
      description: [
        'Create a new artifact shown to the user next to the chat, only',
        'when the user asked for an artifact, app, interactive page, quiz,',
        'game or a document to keep; never for a diagram or code that fits',
        'a fenced block in the reply.',
        `Kinds: ${buildArtifactKindsDescription(input.allowedKinds)}.`,
        `The content is at most ${ARTIFACT_VERSION_MAX_BYTES} bytes.`,
        buildArtifactCodeBlocksDescription(input.allowedKinds),
      ].filter(Boolean).join(' '),
      inputSchema: z.object({
        kind: kindSchema,
        title: titleSchema,
        content: z.string().min(1),
      }),
      async execute({ kind, title, content }) {
        try {
          claimWrite()

          const result = await createArtifact({
            db: input.db,
            storage: input.storage,
            userId: input.userId,
            kind,
            title,
            content,
            originChatId: input.chatId,
            originMessageId: input.messageId,
            createdVia: 'chat',
            createdBy,
            modelId: input.modelId ?? null,
            logger: input.logger,
          })

          knownArtifactIds.add(result.artifactId)
          logWrite({ operation: 'create', kind, version: result.version })

          return result
        } catch (exception) {
          logWrite({
            operation: 'create',
            kind,
            error: exceptionMessage(exception),
          })

          throw toToolError(exception)
        }
      },
    })),
    [UPDATE_ARTIFACT_TOOL_NAME]: withFollowUpTurn(tool({
      description: [
        'Write a new version of an artifact from this chat. Send either',
        '`edits` (exact find-and-replace pairs applied in order; each',
        'old_string must occur exactly once) or `content` (the full new',
        `content), not both. An artifact keeps at most ${ARTIFACT_MAX_VERSIONS}`,
        'versions.',
      ].join(' '),
      inputSchema: z.object({
        artifactId: z.string().min(1).max(64),
        title: titleSchema.optional(),
        content: z.string().min(1).optional(),
        edits: z.array(z.object({
          old_string: z.string().min(1).max(ARTIFACT_VERSION_MAX_BYTES),
          new_string: z.string().max(ARTIFACT_VERSION_MAX_BYTES),
        })).min(1).max(ARTIFACT_EDITS_MAX).optional(),
      }),
      async execute({ artifactId, title, content, edits }) {
        try {
          if ((content === undefined) === (edits === undefined)) {
            throw createToolError(
              ARTIFACT_TOOL_ERROR_CODES.invalidInput,
              'Send exactly one of `edits` or `content`.',
            )
          }

          if (!knownArtifactIds.has(artifactId)) {
            throw createToolError(
              ARTIFACT_TOOL_ERROR_CODES.unknown,
              'Unknown artifact for this chat. Use the id of an artifact '
              + 'created in this chat, or create a new artifact.',
            )
          }

          let nextContent = content as string
          let expectedVersion: number | undefined

          if (edits) {
            claimEditRead()

            const current = await readArtifactVersion({
              db: input.db,
              storage: input.storage,
              userId: input.userId,
              artifactId,
            })

            nextContent = applyArtifactEdits(current.content, edits)
            expectedVersion = current.version
          }

          claimWrite()

          const result = await appendArtifactVersion({
            db: input.db,
            storage: input.storage,
            userId: input.userId,
            artifactId,
            content: nextContent,
            title,
            expectedVersion,
            createdBy,
            modelId: input.modelId ?? null,
            logger: input.logger,
          })

          logWrite({
            operation: 'update',
            mode: edits ? 'edits' : 'content',
            edits: edits?.length ?? 0,
            version: result.version,
          })

          return result
        } catch (exception) {
          logWrite({
            operation: 'update',
            mode: edits ? 'edits' : 'content',
            error: exceptionMessage(exception),
          })

          throw toToolError(exception)
        }
      },
    })),
  }
}
