import { defineConfig, devices } from '@playwright/test'

const AUTH_STATE_PATH = '.playwright/auth-user.json'
const E2E_PORT = process.env.E2E_PORT || '3000'
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`
const WEBKIT_SPECS = [/new-chat-navigation\.spec\.ts/]
const WEBKIT_PROJECTS = process.env.E2E_WEBKIT
  ? [
    {
      name: 'webkit',
      dependencies: ['setup'],
      testMatch: WEBKIT_SPECS,
      use: {
        ...devices['Desktop Safari'],
        serviceWorkers: 'block' as const,
        storageState: AUTH_STATE_PATH,
      },
    },
  ]
  : []
const WEB_SERVER_ENV = {
  ...process.env,
  CI: 'true',
  PORT: E2E_PORT,
  NUXT_PUBLIC_BASE_URL: E2E_BASE_URL,
  NUXT_ENCRYPTION_HASHIDS: 'secret',
  NUXT_ENCRYPTION_KEY: 'secret',
  NUXT_BETTER_AUTH_SECRET: 'secret',
  NUXT_EMAIL_NOOP_ENABLED: 'true',
}

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv'
// import path from 'path'
// dotenv.config({ path: path.resolve(__dirname, '.env') })

/**
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: '**/todo/**/*.spec.ts',
  timeout: 10_000,
  fullyParallel: true,
  // Fail the build on CI
  // if you accidentally left test.only in the source code.
  forbidOnly: !!process.env.CI,
  // One local retry absorbs the non-deterministic Vite dev-reload flake below
  // (a re-run hits now-warm deps); it only masks non-determinism, not real
  // regressions, which fail both attempts. CI keeps 2 retries.
  retries: process.env.CI ? 2 : 1,
  // CI splits E2E across 3 parallel jobs with `--shard`; each job has its own
  // `wrangler dev`, local D1 and `auth.setup` user. Inside a job workers stays
  // 1: most specs share that single user, so parallel workers would see each
  // other's chats and history. Locally, the Vite dev server also broadcasts an
  // HMR full-reload to every page when it pre-bundles a new dependency, which
  // parallel workers would turn into mid-interaction reloads.
  workers: 1,
  // Reporter to use.
  // See https://playwright.dev/docs/test-reporters
  reporter: process.env.CI
    ? [['html'], ['github']]
    : [['html'], ['list']],
  // Shared settings for all the projects below.
  // See https://playwright.dev/docs/api/class-testoptions.
  use: {
    baseURL: E2E_BASE_URL,
    // Collect trace when retrying the failed test.
    // See https://playwright.dev/docs/trace-viewer
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: [
        /auth\.setup\.ts/,
        '**/todo/**/*.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_STATE_PATH,
      },
    },
    ...WEBKIT_PROJECTS,
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'mobile-chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'mobile-safari',
    //   use: { ...devices['iPhone 12'] },
    // },
    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],
  webServer: {
    command: process.env.CI
      ? `pnpm exec wrangler dev --port ${E2E_PORT}`
      : 'pnpm run db:migrate && pnpm run dev',
    env: WEB_SERVER_ENV,
    url: E2E_BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: process.env.CI ? 'pipe' : 'ignore',
    stderr: 'pipe',
  },
})
