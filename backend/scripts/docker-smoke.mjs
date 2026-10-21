import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import {
  assertTestDatabaseUrl,
  composeEnv,
  composeProjectName,
  defaultTestDatabaseUrl,
  normalizeTcpPort,
  postgresPortFromDatabaseUrl,
  repositoryHash,
  repositoryRoot,
} from '../../scripts/repo-env.mjs'

const smokeRunId = `${repositoryHash}-${process.pid}`
const imageName = `seriya-backend:smoke-${smokeRunId}`
const containerName = `seriya-backend-smoke-${smokeRunId}`
const configuredHostPort = process.env.BACKEND_DOCKER_SMOKE_PORT
const smokeComposeProjectName =
  `${composeProjectName}-smoke-${process.pid}`
const networkName = `${smokeComposeProjectName}_default`
const composeArgs = ['compose', '-p', smokeComposeProjectName]
// This smoke test owns its Compose project and database. Do not reuse the
// developer's TEST_DATABASE_URL: its host port may already be occupied by a
// long-lived local test stack, while this project must start independently.
const smokePostgresPort = String(await findOpenPort())
const databaseUrlForHost = defaultTestDatabaseUrl(smokePostgresPort)
const databaseUrlForContainer =
  process.env.BACKEND_DOCKER_SMOKE_DATABASE_URL ??
  'postgresql://superuser:superpassword@postgres_test:5432/seriya_test?schema=public'
assertTestDatabaseUrl(databaseUrlForHost)
assertTestDatabaseUrl(databaseUrlForContainer, {
  allowEnvName: 'BACKEND_DOCKER_SMOKE_ALLOW_NON_TEST_DATABASE',
})
const dockerEnv = composeEnv({
  POSTGRES_TEST_PORT: postgresPortFromDatabaseUrl(databaseUrlForHost),
  COMPOSE_PROJECT_NAME: smokeComposeProjectName,
})
const smokeOwnerEmail = `docker-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
const smokeOwnerPassword = `Docker-smoke-${Math.random().toString(36).slice(2)}-123`

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}`)
  }
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port)
          return
        }

        reject(new Error('Could not allocate an open TCP port'))
      })
    })
  })
}

async function waitForComposePostgres() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = spawnSync(
      'docker',
      [
        ...composeArgs,
        'exec',
        '-T',
        'postgres_test',
        'pg_isready',
        '-U',
        'superuser',
        '-d',
        'seriya_test',
      ],
      {
        cwd: repositoryRoot,
        env: dockerEnv,
        stdio: 'ignore',
      },
    )

    if (result.status === 0) {
      return
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }

  process.stderr.write('Timed out waiting for postgres_test\n')
  throw new Error('Timed out waiting for postgres_test')
}

async function waitForHealth(hostPort) {
  const url = `http://127.0.0.1:${hostPort}/health/ready`

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        process.stdout.write(`Backend Docker smoke passed: ${url}\n`)
        return
      }
    } catch {
      // Retry until the container finishes booting.
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }

  process.stderr.write(`Timed out waiting for ${url}\n`)
  spawnSync('docker', ['logs', containerName], { stdio: 'inherit' })
  throw new Error(`Timed out waiting for ${url}`)
}

async function smokeAuthApi(hostPort) {
  const baseUrl = `http://127.0.0.1:${hostPort}`

  const register = await fetch(`${baseUrl}/api/auth/token/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'registration-must-stay-closed@example.com',
      password: smokeOwnerPassword,
      displayName: 'Docker Smoke',
    }),
  })

  if (register.status !== 403) {
    throw new Error(`Registration closure smoke failed with HTTP ${register.status}: ${await register.text()}`)
  }

  const login = await fetch(`${baseUrl}/api/auth/token/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: smokeOwnerEmail,
      password: smokeOwnerPassword,
    }),
  })

  if (login.status !== 200) {
    throw new Error(`Owner login failed with HTTP ${login.status}: ${await login.text()}`)
  }

  const loginBody = await login.json()
  if (!loginBody.accessToken || !loginBody.refreshToken) {
    throw new Error('Owner login response did not include mobile auth tokens')
  }

  const me = await fetch(`${baseUrl}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${loginBody.accessToken}`,
    },
  })

  if (me.status !== 200) {
    throw new Error(`/me failed with HTTP ${me.status}: ${await me.text()}`)
  }

  const meBody = await me.json()
  if (meBody.user?.email !== smokeOwnerEmail) {
    throw new Error(`/me returned the wrong owner: ${JSON.stringify(meBody)}`)
  }

  process.stdout.write('Backend Docker production auth smoke passed\n')
}

try {
  run('docker', [...composeArgs, 'up', '-d', 'postgres_test'], { env: dockerEnv })
  await waitForComposePostgres()

  // PostgreSQL now owns smokePostgresPort. Choosing the backend port afterwards
  // guarantees that an automatic choice cannot reuse it.
  const hostPort =
    configuredHostPort === undefined
      ? String(await findOpenPort())
      : normalizeTcpPort(configuredHostPort, 'BACKEND_DOCKER_SMOKE_PORT')
  if (hostPort === smokePostgresPort) {
    throw new Error('BACKEND_DOCKER_SMOKE_PORT must differ from the smoke PostgreSQL port')
  }

  run('bun', ['run', '--cwd', 'backend', 'prisma:deploy'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrlForHost,
    },
  })
  run('bun', ['run', '--cwd', 'backend', 'prisma:generate'])
  run('bun', ['run', '--cwd', 'backend', 'catalog:owner', '--', 'bootstrap'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrlForHost,
      OWNER_EMAIL: smokeOwnerEmail,
      OWNER_PASSWORD: smokeOwnerPassword,
      OWNER_DISPLAY_NAME: 'Docker Smoke Owner',
    },
  })

  run('docker', ['build', '-f', 'backend/Dockerfile', '-t', imageName, '.'])
  spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' })

  run('docker', [
    'run',
    '-d',
    '--name',
    containerName,
    '--network',
    networkName,
    '-p',
    `127.0.0.1:${hostPort}:3000`,
    '-e',
    'PORT=3000',
    '-e',
    `DATABASE_URL=${databaseUrlForContainer}`,
    '-e',
    `JWT_SECRET=${'0123456789abcdef'.repeat(4)}`,
    '-e',
    'CORS_ORIGINS=https://web.example.com',
    '-e',
    'COOKIE_SECURE=true',
    '-e',
    'AUTH_REGISTRATION_ENABLED=false',
    imageName,
  ])

  await waitForHealth(hostPort)
  await smokeAuthApi(hostPort)
} finally {
  spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' })
  spawnSync('docker', ['image', 'rm', '--force', imageName], { stdio: 'ignore' })
  spawnSync('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans'], {
    cwd: repositoryRoot,
    env: dockerEnv,
    stdio: 'inherit',
  })
}
