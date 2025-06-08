import stylistic from '@stylistic/eslint-plugin'
// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt([
  stylistic.configs.customize({
    indent: 2,
    semi: false,
    quotes: 'single',
  }),
  {
    plugins: {
      '@stylistic': stylistic,
    },
    files: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.js', '**/*.mjs', '**/*.cjs', '**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
])
