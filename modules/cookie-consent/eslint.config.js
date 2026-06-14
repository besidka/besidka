// @ts-check
import stylistic from '@stylistic/eslint-plugin'
import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'

const stylisticCustomConfig = {
  indent: 2,
  semi: false,
  quotes: 'single',
}

const stylisticResultConfig = stylistic.configs.customize(
  stylisticCustomConfig,
)

export default [
  js.configs.recommended,
  stylisticResultConfig,
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        URL: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        process: 'readonly',
        defineNuxtConfig: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      'no-console': 'warn',
      'no-undef': 'off',
      // TypeScript compiler enforces unused vars in TS files;
      // the base ESLint rule does not understand TS type signatures.
      'no-unused-vars': 'off',
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
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      'no-console': 'warn',
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
  },
  {
    ignores: [
      'dist/**',
      'playground/.nuxt/**',
      'playground/node_modules/**',
      'test/fixtures/**/.nuxt/**',
      '.nuxt/**',
      'node_modules/**',
    ],
  },
]
