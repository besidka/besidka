import type { ToolIndexEntry } from '~~/server/utils/ai/tool-index'

export const TOOL_INDEX_PREFETCH_MAX = 3

const USER_TEXT_MAX_CHARACTERS = 4000

/**
 * Word stems a user may type for an action, in English, Ukrainian, Russian,
 * Polish, German, Spanish and French, each mapped to the verbs tool names
 * use. A stem matches the start of a word, so `видал` covers видали,
 * видалити and видаліть.
 */
const ACTION_STEMS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['delete', ['delete']],
  ['remove', ['delete', 'remove']],
  ['erase', ['delete']],
  ['trash', ['delete']],
  ['видал', ['delete']],
  ['вилуч', ['delete', 'remove']],
  ['стерт', ['delete']],
  ['зітр', ['delete']],
  ['удал', ['delete']],
  ['usuń', ['delete']],
  ['usun', ['delete']],
  ['skasuj', ['delete']],
  ['lösch', ['delete']],
  ['losch', ['delete']],
  ['entfern', ['delete', 'remove']],
  ['elimin', ['delete']],
  ['borra', ['delete']],
  ['supprim', ['delete']],
  ['efface', ['delete']],
  ['rename', ['rename']],
  ['переймен', ['rename']],
  ['переимен', ['rename']],
  ['umbenenn', ['rename']],
  ['renomm', ['rename']],
  ['create', ['create', 'add']],
  ['створ', ['create']],
  ['созда', ['create']],
  ['utwórz', ['create']],
  ['utworz', ['create']],
  ['stwórz', ['create']],
  ['erstell', ['create']],
  ['crea', ['create']],
  ['add', ['add', 'create']],
  ['дода', ['add', 'create']],
  ['добав', ['add', 'create']],
  ['dodaj', ['add', 'create']],
  ['share', ['share']],
  ['поділ', ['share']],
  ['подел', ['share']],
  ['udostępn', ['share']],
  ['udostepn', ['share']],
  ['revoke', ['revoke']],
  ['unshare', ['revoke']],
  ['відклик', ['revoke']],
  ['move', ['move']],
  ['перемі', ['move']],
  ['перенес', ['move']],
  ['перемест', ['move']],
  ['przenie', ['move']],
  ['update', ['update']],
  ['change', ['update']],
  ['edit', ['update']],
  ['змін', ['update']],
  ['онов', ['update']],
  ['измен', ['update']],
  ['обнов', ['update']],
  ['zmień', ['update']],
  ['zmien', ['update']],
  ['branch', ['branch']],
  ['fork', ['branch']],
]

/**
 * Word stems for the things tools act on, mapped to the nouns tool names use
 * (singular; a tool name's plural `files` is matched as `file`).
 */
const OBJECT_STEMS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['file', ['file']],
  ['файл', ['file']],
  ['plik', ['file']],
  ['datei', ['file']],
  ['fichier', ['file']],
  ['archivo', ['file']],
  ['chat', ['chat']],
  ['conversation', ['chat']],
  ['чат', ['chat']],
  ['розмов', ['chat']],
  ['разговор', ['chat']],
  ['czat', ['chat']],
  ['rozmow', ['chat']],
  ['project', ['project']],
  ['проєкт', ['project']],
  ['проект', ['project']],
  ['projekt', ['project']],
  ['proyect', ['project']],
  ['projet', ['project']],
  ['artifact', ['artifact']],
  ['артефакт', ['artifact']],
  ['artefakt', ['artifact']],
  ['note', ['note']],
  ['нотатк', ['note']],
  ['замітк', ['note']],
  ['заметк', ['note']],
  ['notatk', ['note']],
  ['notiz', ['note']],
  ['message', ['message']],
  ['повідомл', ['message']],
  ['сообщ', ['message']],
  ['wiadomo', ['message']],
  ['nachricht', ['message']],
  ['memor', ['memory']],
  ['пам', ['memory']],
  ['pamię', ['memory']],
  ['pamie', ['memory']],
  ['setting', ['setting']],
  ['налашт', ['setting']],
  ['настро', ['setting']],
  ['ustawie', ['setting']],
  ['einstell', ['setting']],
  ['instruction', ['instruction']],
  ['інструкц', ['instruction']],
  ['инструкц', ['instruction']],
  ['instrukc', ['instruction']],
  ['skill', ['skill']],
  ['навич', ['skill']],
  ['навык', ['skill']],
  ['share', ['share']],
  ['посилан', ['share']],
  ['ссылк', ['share']],
  ['link', ['share']],
  ['knowledge', ['knowledge']],
  ['знан', ['knowledge']],
  ['wiedz', ['knowledge']],
  ['issue', ['issue']],
  ['page', ['page']],
  ['сторін', ['page']],
  ['страниц', ['page']],
  ['stron', ['page']],
  ['task', ['task']],
  ['задач', ['task']],
  ['завдан', ['task']],
  ['zadani', ['task']],
  ['comment', ['comment']],
  ['коментар', ['comment']],
  ['комментар', ['comment']],
  ['komentarz', ['comment']],
]

const SHORT_STEM_MAX_LENGTH = 4
const ENGLISH_SUFFIXES = /^(?:s|es|d|ed|ing)?$/
const ASCII_WORD = /^[a-z]+$/

const ACTION_VERBS: ReadonlySet<string> = new Set(
  ACTION_STEMS.flatMap(([, verbs]) => verbs),
)

function wordsOf(text: string): string[] {
  return text
    .slice(0, USER_TEXT_MAX_CHARACTERS)
    .normalize('NFC')
    .toLowerCase()
    .match(/[\p{L}\p{N}'’]+/gu) ?? []
}

/**
 * Whether a typed word starts with a stem. A short English stem must be the
 * whole word or take a plain suffix (`add`, `adds`, `added`), so `add` never
 * matches `address`.
 */
function matchesStem(word: string, stem: string): boolean {
  if (!word.startsWith(stem)) {
    return false
  }

  if (stem.length > SHORT_STEM_MAX_LENGTH || !ASCII_WORD.test(stem)) {
    return true
  }

  return ENGLISH_SUFFIXES.test(word.slice(stem.length))
}

function termsFor(
  words: readonly string[],
  stems: ReadonlyArray<readonly [string, readonly string[]]>,
): Set<string> {
  const terms = new Set<string>()

  for (const word of words) {
    for (const [stem, mapped] of stems) {
      if (matchesStem(word, stem)) {
        mapped.forEach(term => terms.add(term))
      }
    }
  }

  return terms
}

function singular(token: string): string {
  if (token.length > 3 && token.endsWith('ies')) {
    return `${token.slice(0, -3)}y`
  }

  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1)
  }

  return token
}

/**
 * The words of a tool's own name without its namespace: `mcp__notion__
 * delete-page` and `besidka__delete_files` give `delete page` and
 * `delete file`.
 */
export function toolNameTokens(exposedName: string): string[] {
  const local = exposedName.split('__').at(-1) ?? exposedName

  return local
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular)
}

/**
 * The index entries the user's own latest message most likely needs, loaded
 * before the first step so a model that does not call the load tool still
 * has them. A tool matches only when its name has an action verb the
 * message asks for (delete, rename, create, share, move, update, ...) and a
 * thing the message names (file, chat, project, note, ...), in any of the
 * languages above; read tools such as `list_` and `get_` are left to the
 * model. Ties go to the name with fewer extra words, then by name, and at
 * most `TOOL_INDEX_PREFETCH_MAX` are returned. Only the text the user sent
 * is read, never model output or tool results.
 */
export function matchToolIndexEntries(
  userText: string,
  entries: readonly ToolIndexEntry[],
  limit: number = TOOL_INDEX_PREFETCH_MAX,
): string[] {
  const words = wordsOf(userText)

  if (words.length === 0 || entries.length === 0) {
    return []
  }

  const verbs = termsFor(words, ACTION_STEMS)
  const objects = termsFor(words, OBJECT_STEMS)

  if (verbs.size === 0 || objects.size === 0) {
    return []
  }

  return entries
    .map((entry) => {
      const tokens = toolNameTokens(entry.name)
      const toolVerbs = tokens.filter(token => ACTION_VERBS.has(token))
      const hasVerb = toolVerbs.some(token => verbs.has(token))
      const matchedObjects = tokens.filter(token => objects.has(token))

      return {
        name: entry.name,
        isMatch: hasVerb && matchedObjects.length > 0,
        extraWords: tokens.length - 1 - matchedObjects.length,
      }
    })
    .filter(candidate => candidate.isMatch)
    .sort((first, second) => {
      return first.extraWords - second.extraWords
        || first.name.localeCompare(second.name)
    })
    .slice(0, Math.max(0, limit))
    .map(candidate => candidate.name)
}
