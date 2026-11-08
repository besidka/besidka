import { defineConfig, devices } from '@playwright/test'

const RUNTIME_PORT = process.env.ARTIFACTS_RUNTIME_PORT || '8788'
const HOST_PORT = process.env.ARTIFACTS_HOST_PORT || '8789'
const RUNTIME_ORIGIN = `http://127.0.0.1:${RUNTIME_PORT}`
const HOST_ORIGIN = `http://127.0.0.1:${HOST_PORT}`

export default defineConfig({
  testDir: './tests/e2e-artifacts',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['html', { outputFolder: 'playwright-report-artifacts' }], ['github']]
    : [['list']],
  use: {
    baseURL: HOST_ORIGIN,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: [
    {
      command: `pnpm --filter artifacts-runtime build:dev && pnpm --filter artifacts-runtime exec wrangler dev --port ${RUNTIME_PORT} --ip 127.0.0.1`,
      url: `${RUNTIME_ORIGIN}/v1/index.html`,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'node tests/e2e-artifacts/server.mjs',
      url: HOST_ORIGIN,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
