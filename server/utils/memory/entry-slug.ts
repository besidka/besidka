import { MEMORY_LIMITS } from '#shared/utils/memory-policy'

const FALLBACK_SLUG = 'entry'

const TRANSLITERATION: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ie',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  ї: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ь: '',
  ю: 'iu',
  я: 'ia',
  ы: 'y',
  э: 'e',
  ё: 'e',
  ъ: '',
  ł: 'l',
  ø: 'o',
  đ: 'd',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
}

const COMBINING_MARKS_PATTERN = /\p{M}+/gu
const NON_SLUG_RUN_PATTERN = /[^a-z0-9]+/g
const EDGE_HYPHENS_PATTERN = /^-+|-+$/g

function transliterate(value: string): string {
  let transliterated = ''

  for (const character of value) {
    transliterated += TRANSLITERATION[character] ?? character
  }

  return transliterated
}

export function trimSlug(slug: string, maxLength: number): string {
  return slug.slice(0, maxLength).replace(EDGE_HYPHENS_PATTERN, '')
}

export function slugifyMemoryTitle(title: string): string {
  const slug = transliterate(title.normalize('NFC').toLowerCase())
    .normalize('NFKD')
    .replace(COMBINING_MARKS_PATTERN, '')
    .replace(NON_SLUG_RUN_PATTERN, '-')
    .replace(EDGE_HYPHENS_PATTERN, '')

  const trimmedSlug = trimSlug(slug, MEMORY_LIMITS.maxSlugChars)

  return trimmedSlug || FALLBACK_SLUG
}

export function suffixMemorySlug(slug: string, attempt: number): string {
  if (attempt <= 1) {
    return slug
  }

  const suffix = `-${attempt}`
  const base = trimSlug(slug, MEMORY_LIMITS.maxSlugChars - suffix.length)

  return `${base || FALLBACK_SLUG}${suffix}`
}
