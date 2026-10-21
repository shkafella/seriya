import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const repositoryHash = createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 12)
export const composeProjectName =
  process.env.COMPOSE_PROJECT_NAME ?? `seriya-${repositoryHash}`
export const defaultPostgresTestPort =
  process.env.POSTGRES_TEST_PORT ?? String(30000 + (Number.parseInt(repositoryHash.slice(0, 6), 16) % 20000))

export function defaultTestDatabaseUrl(port = defaultPostgresTestPort) {
  return `postgresql://superuser:superpassword@localhost:${port}/seriya_test?schema=public`
}

export function postgresPortFromDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl)
  if (url.port) return url.port
  return '5432'
}

export function normalizeTcpPort(value, environmentName = 'TCP port') {
  const candidate = String(value).trim()

  if (!/^\d+$/.test(candidate)) {
    throw new Error(`${environmentName} must be an integer TCP port`)
  }

  const port = Number(candidate)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${environmentName} must be between 1 and 65535`)
  }

  return String(port)
}

export function assertTestDatabaseUrl(
  databaseUrl,
  { allowEnvName = 'TEST_ALLOW_NON_TEST_DATABASE' } = {},
) {
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '')

  if (!databaseName.endsWith('_test') && process.env[allowEnvName] !== '1') {
    throw new Error(
      `Refusing to run tests against non-test database "${databaseName}". Use a *_test database or set ${allowEnvName}=1 intentionally.`,
    )
  }
}

export function composeEnv(extra = {}) {
  return {
    ...process.env,
    POSTGRES_TEST_PORT: defaultPostgresTestPort,
    COMPOSE_PROJECT_NAME: composeProjectName,
    ...extra,
  }
}
