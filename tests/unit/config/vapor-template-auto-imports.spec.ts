import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { compileScript, parse } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..')
const APP_DIRECTORY = join(PROJECT_ROOT, 'app')
const VAPOR_BLOCK_ATTRIBUTE = /<(?:script|template)\b[^>]*?\svapor(?=[\s>])/
const PROPS_ACCESS = /__props\.([$\w]+)/g
const PROP_BINDING_TYPES = new Set(['props', 'props-aliased'])

function listVueFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => {
      return entry.isFile() && entry.name.endsWith('.vue')
    })
    .map((entry) => {
      return join(entry.parentPath, entry.name)
    })
    .sort()
}

function findUndeclaredPropsAccesses(
  source: string,
  filename: string,
): string[] {
  const { descriptor } = parse(source, { filename })

  if (!descriptor.vapor || !descriptor.scriptSetup) {
    return []
  }

  const compiled = compileScript(descriptor, {
    id: filename,
    inlineTemplate: true,
    isProd: true,
  })
  const declaredProps = new Set(
    Object.entries(compiled.bindings ?? {})
      .filter(([, bindingType]) => {
        return PROP_BINDING_TYPES.has(String(bindingType))
      })
      .map(([name]) => name),
  )
  const accessedNames = [...compiled.content.matchAll(PROPS_ACCESS)]
    .map(match => match[1] as string)

  return [...new Set(accessedNames)].filter((name) => {
    return !declaredProps.has(name)
  })
}

const vaporComponents = listVueFiles(APP_DIRECTORY)
  .filter((file) => {
    return VAPOR_BLOCK_ATTRIBUTE.test(readFileSync(file, 'utf8'))
  })
  .map((file) => {
    return relative(PROJECT_ROOT, file)
  })

describe('Vapor template auto-imports', () => {
  it('detects an auto-imported template function read from props', () => {
    const fixture = [
      '<template><p>{{ formatLabel(label) }}</p></template>',
      '<script setup lang="ts" vapor>',
      'defineProps<{ label: string }>()',
      '</script>',
    ].join('\n')

    expect(findUndeclaredPropsAccesses(fixture, 'Fixture.vue'))
      .toEqual(['formatLabel'])
  })

  it('finds the Vapor components to check', () => {
    expect(vaporComponents.length).toBeGreaterThan(0)
  })

  it.each(vaporComponents)(
    '%s imports every non-prop template identifier explicitly',
    (file) => {
      const source = readFileSync(join(PROJECT_ROOT, file), 'utf8')

      expect(findUndeclaredPropsAccesses(source, file)).toEqual([])
    },
  )
})
