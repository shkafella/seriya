import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const e2eRoot = fileURLToPath(new URL('.', import.meta.url))
const websiteRoot = resolve(e2eRoot, '../../website')
const configuratorPort = Number(process.env.E2E_CONFIGURATOR_PORT ?? 6174)

if (!Number.isInteger(configuratorPort) || configuratorPort < 1 || configuratorPort > 65_535) {
  throw new Error('E2E_CONFIGURATOR_PORT must be a valid TCP port')
}

const configuratorUrl = `http://127.0.0.1:${configuratorPort}`
process.env.E2E_CONFIGURATOR_PORT = String(configuratorPort)

/**
 * The phone configurator is a standalone Astro page. Its browser test mocks
 * only its HTTP boundary, so it stays fast and needs no unrelated database.
 */
export default defineConfig({
  testDir: './specs',
  testMatch: 'configurator.spec.ts',
  outputDir: './.artifacts/configurator-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '.artifacts/configurator-report' }]],
  use: {
    baseURL: configuratorUrl,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `bun run dev --host 127.0.0.1 --port ${configuratorPort}`,
    cwd: websiteRoot,
    env: { ...process.env, PUBLIC_API_BASE_URL: `${configuratorUrl}/api` },
    url: configuratorUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
