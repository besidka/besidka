import { defineConfig, devices } from '@playwright/test'

const AUTH_STATE_PATH = '.playwright/auth-user.json'
const WEB_SERVER_ENV = {
  ...process.env,
  CI: 'true',
  NUXT_PUBLIC_BASE_URL: 'http://localhost:3000',
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
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // Reporter to use.
  // See https://playwright.dev/docs/test-reporters
  reporter: process.env.CI
    ? [['html'], ['github']]
    : [['html'], ['list']],
  // Shared settings for all the projects below.
  // See https://playwright.dev/docs/api/class-testoptions.
  use: {
    baseURL: 'http://localhost:3000',
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
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
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
    command: 'pnpm run db:migrate && pnpm run dev',
    env: WEB_SERVER_ENV,
    url: 'http://localhost:3000',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
