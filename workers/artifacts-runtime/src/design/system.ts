import { compile } from 'tailwindcss'
import tailwindIndexCss from 'tailwindcss/index.css'
import daisyui from 'daisyui'
import daisyuiTheme from 'daisyui/theme'
import { NUNITO_FONT_FACES } from './fonts.ts'
import { createDesignInputCss } from './stylesheet.ts'

export interface DesignCompiler {
  build: (candidates: string[]) => string
}

type CompileOptions = NonNullable<Parameters<typeof compile>[1]>

type LoadedPlugin = Awaited<
  ReturnType<NonNullable<CompileOptions['loadModule']>>
>['module']

const PLUGINS: Record<string, LoadedPlugin> = {
  'daisyui': daisyui as LoadedPlugin,
  'daisyui/theme': daisyuiTheme as LoadedPlugin,
}

async function loadStylesheet(id: string, base: string) {
  if (id !== 'tailwindcss') {
    throw new Error(`Artifacts cannot import the stylesheet "${id}".`)
  }

  return {
    path: 'virtual:tailwindcss/index.css',
    base,
    content: tailwindIndexCss,
  }
}

async function loadModule(id: string, base: string) {
  const module = PLUGINS[id]

  if (!module) {
    throw new Error(`Artifacts cannot load the Tailwind plugin "${id}".`)
  }

  return { path: `virtual:${id}`, base, module }
}

/**
 * Compiles the Besidka design input (Tailwind 4, daisyUI 5, the generated
 * theme and Nunito) once. The returned `build` takes class candidates and
 * returns the CSS for every candidate seen so far; unknown candidates are
 * ignored, so any class name can be passed.
 */
export async function createDesignCompiler(): Promise<DesignCompiler> {
  const compiler = await compile(createDesignInputCss(NUNITO_FONT_FACES), {
    base: '/',
    loadStylesheet,
    loadModule,
  })

  return {
    build: (candidates) => {
      return compiler.build(candidates)
    },
  }
}
