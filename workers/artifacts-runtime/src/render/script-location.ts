const SCRIPT_OPEN_TAG = /<script\b[^>]*>/gi

const SCRIPT_CLOSE_TAG = /<\/script\s*>/gi

const COMMENT_PATTERN = /<!--[\s\S]*?-->/g

const BINDING_PREFIX = /^Failed to execute '[^']+' on '[^']+': /

export interface InlineScriptSource {
  content: string
  startLine: number
}

export interface ArtifactScriptLocation {
  line: number
}

export interface ScriptSpan {
  startLine: number
  lineCount: number
}

let executingInline: ScriptSpan | null = null

const moduleScriptSpans = new Map<string, ScriptSpan>()

function countLines(text: string, end: number): number {
  let lines = 1

  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lines += 1
    }
  }

  return lines
}

function blankComments(html: string): string {
  return html.replace(COMMENT_PATTERN, (comment) => {
    return comment.replace(/[^\n]/g, ' ')
  })
}

/**
 * Finds every `<script>` in the artifact HTML the way the HTML tokenizer
 * does (raw text up to the next `</script>`, comments skipped) and records
 * the source line its text starts on, so a script error can name a line of
 * the artifact rather than a line of the script.
 */
export function findInlineScripts(html: string): InlineScriptSource[] {
  const searchable = blankComments(html)
  const scripts: InlineScriptSource[] = []

  SCRIPT_OPEN_TAG.lastIndex = 0

  let open = SCRIPT_OPEN_TAG.exec(searchable)

  while (open) {
    const contentStart = open.index + open[0].length

    SCRIPT_CLOSE_TAG.lastIndex = contentStart

    const close = SCRIPT_CLOSE_TAG.exec(searchable)
    const contentEnd = close ? close.index : html.length

    scripts.push({
      content: html.slice(contentStart, contentEnd).replace(/\r\n?/g, '\n'),
      startLine: countLines(html, contentStart),
    })

    if (!close) {
      break
    }

    SCRIPT_OPEN_TAG.lastIndex = close.index + close[0].length
    open = SCRIPT_OPEN_TAG.exec(searchable)
  }

  return scripts
}

/**
 * Pairs the scripts the parser produced (document order) with their source
 * text. A script whose text is not found next in the source (one built from
 * a `<template>` or rewritten by the parser) gets no line.
 */
export function matchScriptLines(
  sources: InlineScriptSource[],
  contents: string[],
): (number | null)[] {
  let cursor = 0

  return contents.map((content) => {
    for (let index = cursor; index < sources.length; index += 1) {
      if (sources[index]?.content === content) {
        cursor = index + 1

        return sources[index]?.startLine ?? null
      }
    }

    return null
  })
}

export function countScriptLines(content: string): number {
  return content.split('\n').length
}

export function beginInlineScript(span: ScriptSpan | null) {
  executingInline = span
}

export function endInlineScript() {
  executingInline = null
}

export function registerModuleScript(url: string, span: ScriptSpan | null) {
  if (span) {
    moduleScriptSpans.set(url, span)
  }
}

export function forgetModuleScript(url: string) {
  moduleScriptSpans.delete(url)
}

/**
 * The artifact source line of an error raised while one of its scripts was
 * being compiled or run for the first time: inline scripts run inside the
 * `replaceWith` that inserts them, module scripts are found by their blob
 * URL. Browsers number those lines from the script's first line; a line
 * past the end of that script belongs to another one (a function it called,
 * a listener it triggered) and is not mapped.
 */
export function locateScriptError(
  filename: string,
  lineno: number,
  documentUrl: string = globalThis.location?.href ?? '',
): ArtifactScriptLocation | null {
  const inlineSpan = filename === documentUrl ? executingInline : null
  const span = moduleScriptSpans.get(filename) ?? inlineSpan

  if (!span || lineno < 1 || lineno > span.lineCount) {
    return null
  }

  return { line: span.startLine + lineno - 1 }
}

/**
 * The first source line of the inline script being inserted right now, for
 * an error the browser muted (WebKit hides the details of script errors in
 * the sandboxed frame), so the report can still point at the script.
 */
export function getExecutingScriptStartLine(): number | null {
  return executingInline?.startLine ?? null
}

export function stripBindingPrefix(message: string): string {
  return message.replace(BINDING_PREFIX, '')
}

/**
 * Words an error from the artifact's own script for the person and for
 * "Ask to fix": the browser's "Failed to execute 'replaceWith'…" wrapper
 * (Chrome adds it to a script inserted by the runtime) is dropped, and the
 * line is the line in the artifact source.
 */
export function describeArtifactScriptError(
  error: { name?: string, message?: string } | null,
  fallbackMessage: string,
  location: ArtifactScriptLocation,
  column: number,
): string {
  const fallback = /^(?:Uncaught )?(?:(\w+): )?([\s\S]*)$/
    .exec(fallbackMessage)
  const name = error?.name || fallback?.[1] || 'Error'
  const message = stripBindingPrefix(error?.message || fallback?.[2] || '')
  const position = column > 0
    ? `line ${location.line}, column ${column}`
    : `line ${location.line}`

  return `${name} in the artifact's script (${position}): ${message}`
}
