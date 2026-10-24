import { afterAll, describe, expect, test } from 'bun:test'

import { createPrisma, type DbClient } from '../../db'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe.serial : describe.skip

maybeDescribe('Stage 4 lead persistence acceptance contract', () => {
  const clients: DbClient[] = []
  const freshDb = () => {
    const client = createPrisma(databaseUrl!)
    clients.push(client)
    return client
  }

  afterAll(async () => {
    await Promise.allSettled(clients.map((client) => client.$disconnect()))
  }, 30_000)

  async function expectConstraint(operation: () => Promise<unknown>, constraint: RegExp) {
    try {
      await operation()
      throw new Error('Database accepted an invalid Stage 4 foundation row')
    } catch (caught) {
      expect(String(caught)).toMatch(constraint)
    }
  }

  function budgetData(suffix: string) {
    return {
      singletonKey: `stage4-budget-${suffix}`,
      windowStartedAt: new Date('2026-10-24T00:00:00.000Z'),
      windowEndsAt: new Date('2026-10-25T00:00:00.000Z'),
      windowIntentLimit: 10,
      tombstoneCap: 10,
      attemptCap: 10,
      checkpointCap: 10,
    }
  }

  test('rejects negative recovery-budget counters in PostgreSQL', async () => {
    const prisma = freshDb()
    await expectConstraint(() => prisma.leadAdmissionBudgetState.create({
      data: { ...budgetData('negative'), pendingAttempts: -1 },
    }), /lead_budget_nonnegative/)
  })

  test('rejects every D-23 conservation overflow in PostgreSQL', async () => {
    const prisma = freshDb()
    const overflows = [
      { singletonKey: 'tombstone', tombstoneCap: 0, pendingTombstoneReservations: 1 },
      { singletonKey: 'attempt', attemptCap: 0, pendingAttempts: 1 },
      { singletonKey: 'checkpoint', checkpointCap: 0, uncheckpointedBatches: 1 },
    ]
    for (const overflow of overflows) {
      await expectConstraint(() => prisma.leadAdmissionBudgetState.create({
        data: { ...budgetData(`overflow-${overflow.singletonKey}`), ...overflow },
      }), /lead_budget_(tombstone|attempt|checkpoint)_conserved/)
    }
  })

  test('rejects a released reservation that still owns recovery work', async () => {
    const prisma = freshDb()
    await expectConstraint(() => prisma.leadAdmissionReservation.create({
      data: {
        lifecycle: 'RELEASED',
        tombstoneState: 'FREE',
        attemptState: 'FREE',
        cleanupState: 'FREE',
      },
    }), /lead_reservation_release_is_clean/)
    const released = await prisma.leadAdmissionReservation.create({
      data: {
        lifecycle: 'RELEASED',
        tombstoneState: 'FREE',
        attemptState: 'FREE',
        cleanupState: 'FREE',
        lastArtifactInventoryChecksum: 'sha256:empty-inventory',
      },
    })
    await prisma.leadAdmissionReservation.delete({ where: { id: released.id } })
  })

  test('rejects artifact phases without their durable head and purge proofs', async () => {
    const prisma = freshDb()
    const generation = await prisma.backupSnapshotGeneration.create({
      data: {
        exportedSnapshotId: `stage4-${crypto.randomUUID()}`,
        releaseId: 'stage4-foundation-test',
        dependencySetChecksum: 'sha256:dependencies',
        manifestSchemaVersion: 1,
        recoveryBundleChecksum: 'sha256:recovery-bundle',
      },
    })
    const base = {
      snapshotGenerationId: generation.id,
      scope: 'LEAD' as const,
      schemaVersion: 1,
      versionInventory: {},
      versionInventoryChecksum: 'sha256:versions',
      encryptedObjectInventory: {},
    }
    await expectConstraint(() => freshDb().backupArtifact.create({
      data: { ...base, state: 'ADMISSION_PUBLISHED' },
    }), /backup_artifact_head_phase_proven/)
    await expectConstraint(() => freshDb().backupArtifact.create({
      data: {
        ...base,
        state: 'PURGE_RECEIPT_PUBLISHED',
        recoveryCapAt: new Date('2026-10-24T00:00:00.000Z'),
        lifecycleReceipt: {},
        intendedProtectionRevision: 1,
        attestationChecksum: 'sha256:attestation',
        lifecycleRecordChecksum: 'sha256:lifecycle',
        scopeHeadSequence: 1n,
        scopeHeadHash: 'sha256:scope-head',
      },
    }), /backup_artifact_purge_receipt_proven/)
    await expectConstraint(() => freshDb().backupArtifact.create({
      data: {
        ...base,
        state: 'READY',
        lifecycleRecordChecksum: 'sha256:lifecycle',
        scopeHeadSequence: 1n,
        scopeHeadHash: 'sha256:scope-head',
      },
    }), /backup_artifact_ready_proven/)
    await expectConstraint(() => freshDb().backupArtifact.create({
      data: {
        ...base,
        state: 'RETIRED',
        recoveryCapAt: new Date('2026-10-24T00:00:00.000Z'),
        lifecycleReceipt: {},
        intendedProtectionRevision: 1,
        attestationChecksum: 'sha256:attestation',
        lifecycleRecordChecksum: 'sha256:lifecycle',
        scopeHeadSequence: 1n,
        scopeHeadHash: 'sha256:scope-head',
        purgeReceiptChecksum: 'sha256:purge-receipt',
      },
    }), /backup_artifact_terminal_purge_proven/)
    await prisma.backupSnapshotGeneration.delete({ where: { id: generation.id } })
  }, 15_000)

  test('physically separates core and lead recovery-provider fences', async () => {
    const fenceData = (scope: 'GLOBAL' | 'CORE' | 'LEAD') => ({
      operationId: crypto.randomUUID(),
      scope,
      sourceHostEpoch: 1n,
      operationKind: 'stage4-foundation-test',
      providerConfigChecksum: 'sha256:provider-config',
      requestedPrefixChecksum: 'sha256:prefix',
      objectKey: 'stage4/test',
      requestChecksum: 'sha256:request',
      intendedCapabilityKind: 'read',
      issuanceSelector: 'test',
      requestedPolicy: {},
      revocationSelector: 'test',
      maxAcceptedRequestLifetimeMs: 60_000n,
      phaseSigningKeyVersion: 1,
      headPhaseHash: 'sha256:phase',
      headPhaseSignature: 'signature',
      offHostPrefix: 'stage4/',
      offHostHeadChecksum: 'sha256:head',
      retainUntil: new Date('2026-10-25T00:00:00.000Z'),
    })
    await expectConstraint(() => freshDb().recoveryProviderOperationFence.create({
      data: fenceData('LEAD'),
    }), /recovery_provider_scope_is_core/)
    await expectConstraint(() => freshDb().leadRecoveryProviderOperationFence.create({
      data: fenceData('CORE'),
    }), /lead_recovery_provider_scope_is_lead/)
  })

  type PersistenceAcceptanceResult = { outcome: string; observedSubmissionKeys: number }
  type PersistenceAcceptanceSubject = {
    commitAtomic(input: { idempotencyDigest: string }): Promise<PersistenceAcceptanceResult>
    serializePolicyRace(input: { publicationId: string }): Promise<PersistenceAcceptanceResult>
    createIntent(input: { idempotencyDigest: string }): Promise<PersistenceAcceptanceResult>
    coordinateAbandonment(input: { idempotencyDigest: string }): Promise<PersistenceAcceptanceResult>
    replaySubmission(input: { idempotencyDigest: string; payloadFingerprint: string }): Promise<PersistenceAcceptanceResult>
    eraseLead(input: { reference: string }): Promise<PersistenceAcceptanceResult>
    storeContact(input: { phone: string }): Promise<PersistenceAcceptanceResult>
    decideNotification(input: { deliveryMode: 'telegram_enabled' | 'telegram_disabled' }): Promise<PersistenceAcceptanceResult>
  }

  // This is the replaceable seam for the Stage 4.4/4.5 persistence adapter.
  // The tests below already arrange inputs and assert their observable outcome;
  // they turn green only when the real adapter is supplied here.
  function createPersistenceAcceptanceSubject(prisma: DbClient): PersistenceAcceptanceSubject {
    const missing = async (): Promise<PersistenceAcceptanceResult> => ({
      outcome: 'not_implemented',
      observedSubmissionKeys: await prisma.leadSubmissionKey.count(),
    })
    return {
      commitAtomic: missing,
      serializePolicyRace: missing,
      createIntent: missing,
      coordinateAbandonment: missing,
      replaySubmission: missing,
      eraseLead: missing,
      storeContact: missing,
      decideNotification: missing,
    }
  }

  // Stage 4.1 deliberately checks in executable expected-red contracts. Each
  // becomes an ordinary green integration test when its Stage 4.4/4.5 adapter
  // is implemented; unlike test.todo, these run against migrated PostgreSQL now.
  test.failing('commits recalculated snapshot, lead, notification, and registry in one transaction', async () => {
    const result = await createPersistenceAcceptanceSubject(freshDb()).commitAtomic({ idempotencyDigest: 'sha256:atomic' })
    expect(result).toEqual({ outcome: 'committed', observedSubmissionKeys: 1 })
  })
  test.failing('serializes publication activation and policy transition races against submission', async () => {
    const result = await createPersistenceAcceptanceSubject(freshDb()).serializePolicyRace({ publicationId: crypto.randomUUID() })
    expect(result).toEqual({ outcome: 'serialized', observedSubmissionKeys: 1 })
  })
  test.failing('creates and recovers one bounded registry intent without admitting a missing key on submit', async () => {
    const result = await createPersistenceAcceptanceSubject(freshDb()).createIntent({ idempotencyDigest: 'sha256:intent' })
    expect(result).toEqual({ outcome: 'intent_created', observedSubmissionKeys: 1 })
  })
  test.failing('serializes submit versus abandon and never reopens an expired submitting claim', async () => {
    const result = await createPersistenceAcceptanceSubject(freshDb()).coordinateAbandonment({ idempotencyDigest: 'sha256:abandon' })
    expect(result).toEqual({ outcome: 'abandoned', observedSubmissionKeys: 1 })
  })
  test.failing('replays the same completed payload and rejects changed payload or schema content', async () => {
    const result = await createPersistenceAcceptanceSubject(freshDb()).replaySubmission({
      idempotencyDigest: 'sha256:replay',
      payloadFingerprint: 'sha256:payload',
    })
    expect(result).toEqual({ outcome: 'replayed', observedSubmissionKeys: 1 })
  })
  test.failing('returns the bounded erased tombstone contract after complete graph deletion', async () => {
    const result = await createPersistenceAcceptanceSubject(freshDb()).eraseLead({ reference: 'AAAAAAAAAAAAAAAAAAAAAA' })
    expect(result).toEqual({ outcome: 'erased', observedSubmissionKeys: 1 })
  })
  test.failing('stores contact data as authenticated ciphertext and exposes it only to the owner', async () => {
    const result = await createPersistenceAcceptanceSubject(freshDb()).storeContact({ phone: '+79990000000' })
    expect(result).toEqual({ outcome: 'encrypted', observedSubmissionKeys: 1 })
  })
  test.failing('creates pending or terminally suppressed notification state from the locked policy decision', async () => {
    const result = await createPersistenceAcceptanceSubject(freshDb()).decideNotification({ deliveryMode: 'telegram_disabled' })
    expect(result).toEqual({ outcome: 'suppressed', observedSubmissionKeys: 1 })
  })
})
