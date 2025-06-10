import stylistic from '@stylistic/eslint-plugin'
// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

const generalConfig = {
  plugins: {
    '@stylistic': stylistic,
  },
  files: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.js', '**/*.mjs', '**/*.cjs', '**/*.vue'],
  rules: {
    'no-console': 'warn',
    'unicorn/prefer-number-properties': 'off',
    'vue/multi-word-component-names': 'off',
    'vue/no-multiple-template-root': 'off',
    'vue/no-v-html': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-invalid-void-type': 'off',
    '@typescript-eslint/no-unused-expressions': 'off',
    '@typescript-eslint/no-unsafe-function-type': 'off',
    '@typescript-eslint/consistent-type-imports': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'after-used',
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: false,
        reportUsedIgnorePattern: false,
      },
    ],
    '@stylistic/indent': ['error', 2],
    '@stylistic/brace-style': ['error', '1tbs'],
    '@stylistic/max-len': [
      'error',
      {
        code: 80,
        ignorePattern: '^(import\\s.+\\sfrom\\s.+|\\} from)|.*class=".*"',
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
      },
    ],
  },
}

const stylisticCustomConfig = {
  indent: 2,
  semi: false,
  quotes: 'single',
}

const stylisticResultConfig = stylistic.configs.customize(stylisticCustomConfig)

export const configNuxt = [stylisticResultConfig, generalConfig]

export default withNuxt(configNuxt).append({
  ignores: [
    'auth-schema.ts',
  ],
})
