import 'dotenv/config'

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { publicCatalogSchema } from '@seriya/contracts'
import { createPrisma } from '../src/db'
import { CatalogService } from '../src/modules/catalog'

const command = process.argv[2]
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const expectedDatabase = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''))

const db = createPrisma(databaseUrl)
const service = new CatalogService(db)
try {
  if (command === 'prepare') {
    const candidate = await service.prepareCandidate()
    if (process.argv[3]) await writeFile(resolve(process.argv[3]), `${JSON.stringify(candidate, null, 2)}\n`, { flag: 'w' })
    console.log(JSON.stringify(candidate))
  } else if (command === 'export') {
    const candidateId = requiredArg(3, 'candidate ID')
    const output = resolve(process.argv[4] ?? '../website/src/data/catalog.public.v1.json')
    const candidate = await db.catalogPublication.findUniqueOrThrow({ where: { id: candidateId } })
    const snapshot = publicCatalogSchema.parse(candidate.snapshot)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'w' })
    console.log(JSON.stringify({ output, publicationId: snapshot.publicationId, releaseId: snapshot.releaseId }))
  } else if (command === 'begin' || command === 'activate') {
    const candidateId = requiredArg(3, 'candidate ID')
    const candidate = await db.catalogPublication.findUniqueOrThrow({ where: { id: candidateId } })
    const snapshot = publicCatalogSchema.parse(candidate.snapshot)
    const receiptPath = resolve(requiredArg(4, 'backup receipt path'))
    const backupReceipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    const activation = {
      candidateId,
      releaseId: snapshot.releaseId,
      releasePath: requiredArg(5, 'release path'),
      previousReleasePath: process.argv[6],
      backupReceipt,
      expectedDatabase,
      requireProductionAssets: process.env.CATALOG_REQUIRE_PRODUCTION_ASSETS !== 'false',
    }
    console.log(JSON.stringify(command === 'begin'
      ? await service.beginActivation(activation)
      : await service.activateCandidate(activation)))
  } else if (command === 'mark-application') {
    const candidateId = requiredArg(3, 'candidate ID')
    const releasePath = requiredArg(4, 'release path')
    await service.markApplicationSwitched(candidateId, releasePath)
    console.log(JSON.stringify({ candidateId, releasePath, applicationSwitched: true }))
  } else if (command === 'verify') {
    console.log(JSON.stringify(await service.verifyActivation(requiredArg(3, 'candidate ID'), requiredArg(4, 'release path'))))
  } else if (command === 'bootstrap-public-verification') {
    console.log(JSON.stringify(await service.bootstrapPublicVerification()))
  } else if (command === 'recovery-plan') {
    const requestedCandidateId = process.argv[3]
    const attempt = await db.catalogActivationAttempt.findFirst({
      where: {
        ...(requestedCandidateId ? { nextPublicationId: requestedCandidateId } : {}),
        status: { in: requestedCandidateId
          ? ['PREPARED', 'APPLICATION_SWITCHED', 'PUBLICATION_SWITCHED', 'FAILED', 'VERIFIED']
          : ['PREPARED', 'APPLICATION_SWITCHED', 'PUBLICATION_SWITCHED', 'FAILED'] },
      },
      orderBy: { createdAt: 'desc' },
    })
    console.log(JSON.stringify(attempt ? {
      attemptId: attempt.id,
      candidateId: attempt.nextPublicationId,
      status: attempt.status,
      previousReleasePath: attempt.previousReleasePath,
      nextReleasePath: attempt.nextReleasePath,
    } : null))
  } else if (command === 'start-recovery') {
    const attempt = await service.startRecovery(requiredArg(3, 'candidate ID'))
    console.log(attempt ? `Recovery started for attempt ${attempt.id}` : 'No matching catalog activation attempt')
  } else if (command === 'recover') {
    const attempt = await service.recoverActivation(process.argv[3])
    console.log(attempt ? `Restored previous publication for attempt ${attempt.id}` : 'No matching catalog activation attempt')
  } else {
    throw new Error('Usage: catalog-release.ts prepare|export|begin|mark-application|activate|verify|bootstrap-public-verification|recovery-plan|start-recovery|recover')
  }
} finally {
  await db.$disconnect()
}

function requiredArg(index: number, label: string) {
  const value = process.argv[index]
  if (!value) throw new Error(`Missing ${label}`)
  return value
}
