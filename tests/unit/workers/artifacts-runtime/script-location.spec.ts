import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  beginInlineScript,
  describeArtifactScriptError,
  endInlineScript,
  findInlineScripts,
  forgetModuleScript,
  locateScriptError,
  matchScriptLines,
  registerModuleScript,
  stripBindingPrefix,
} from '~~/workers/artifacts-runtime/src/render/script-location'

const BROKEN_QUIZ = readFileSync(
  join(process.cwd(), 'tests/fixtures/artifacts/kyiv-quiz-syntax-error.html'),
  'utf8',
)
const DOCUMENT_URL = 'https://runtime.example/v1/index.html'

describe('artifact script locations', () => {
  afterEach(() => {
    endInlineScript()
  })

  it('finds the line each script of the generated quiz starts on', () => {
    const scripts = findInlineScripts(BROKEN_QUIZ)

    expect(scripts).toHaveLength(1)
    expect(scripts[0]?.startLine).toBe(30)
    expect(scripts[0]?.content).toContain('function finish()')
  })

  it('skips commented scripts and reads raw script text to its end', () => {
    const html = [
      '<!-- <script>ignored()</script> -->',
      '<script>const tag = "<script>"; one()</script>',
      '<p>text</p>',
      '<script type="module">',
      'two()',
      '</script>',
    ].join('\n')
    const scripts = findInlineScripts(html)

    expect(scripts.map(script => script.startLine)).toEqual([2, 4])
    expect(scripts[0]?.content).toBe('const tag = "<script>"; one()')
  })

  it('pairs parsed scripts with their source lines in order', () => {
    const sources = [
      { content: 'a()', startLine: 3 },
      { content: 'template()', startLine: 7 },
      { content: 'b()', startLine: 12 },
    ]

    expect(matchScriptLines(sources, ['a()', 'b()', 'missing()']))
      .toEqual([3, 12, null])
  })

  it('maps an error raised while an inline script runs to the artifact line',
    () => {
      beginInlineScript(30)

      expect(locateScriptError(DOCUMENT_URL, 15, DOCUMENT_URL))
        .toEqual({ line: 44 })
      expect(locateScriptError('https://runtime.example/main.js', 15, DOCUMENT_URL))
        .toBeNull()

      endInlineScript()

      expect(locateScriptError(DOCUMENT_URL, 15, DOCUMENT_URL)).toBeNull()
    })

  it('maps a module script error by its blob URL', () => {
    registerModuleScript('blob:module-1', 10)

    expect(locateScriptError('blob:module-1', 2, DOCUMENT_URL))
      .toEqual({ line: 11 })

    forgetModuleScript('blob:module-1')

    expect(locateScriptError('blob:module-1', 2, DOCUMENT_URL)).toBeNull()
  })

  it('drops the browser wrapper that blames the runtime', () => {
    const error = new SyntaxError(
      'Failed to execute \'replaceWith\' on \'Element\': Unexpected token \'}\'',
    )

    expect(stripBindingPrefix(error.message)).toBe('Unexpected token \'}\'')
    expect(describeArtifactScriptError(error, '', { line: 44 }, 26)).toBe(
      'SyntaxError in the artifact\'s script (line 44, column 26): '
      + 'Unexpected token \'}\'',
    )
    expect(describeArtifactScriptError(
      null,
      'Uncaught SyntaxError: Unexpected identifier',
      { line: 3 },
      0,
    )).toBe(
      'SyntaxError in the artifact\'s script (line 3): Unexpected identifier',
    )
  })
})
