import { describe, expect, test } from 'bun:test'

import {
  backupScopeManifest,
  type BackupScopeTable,
  validateBackupScopeManifest,
} from './backup-scope-manifest'

const schemaPath = new URL('../../../../prisma/schema.prisma', import.meta.url)
const stage4MigrationPath = new URL(
  '../../../../prisma/migrations/20261024120000_stage4a_foundation/migration.sql',
  import.meta.url,
)

function manifestCopy() {
  return {
    tables: backupScopeManifest.tables.map((entry): BackupScopeTable => ({
      ...entry,
      dependencies: [...entry.dependencies],
      deferredDependencies: [...entry.deferredDependencies],
    })),
  }
}

describe('Stage 4A backup scope manifest', () => {
  test('assigns every physical Prisma table exactly once and contains no Stage 4B table', async () => {
    const schema = await Bun.file(schemaPath).text()
    expect(() => validateBackupScopeManifest(schema)).not.toThrow()
    expect(backupScopeManifest.tables.filter((entry) => entry.dataScope === 'lead').length).toBeGreaterThan(0)
    expect(backupScopeManifest.tables.some((entry) => /share/i.test(entry.table))).toBe(false)
  })

  test('fails closed when schema and manifest drift', async () => {
    const schema = await Bun.file(schemaPath).text()
    expect(() => validateBackupScopeManifest(`${schema}\nmodel Drift { id String @id @@map("drift") }`)).toThrow('Missing physical table: drift')
    expect(() => validateBackupScopeManifest(`${schema}\nmodel UnmappedDrift { id String @id }`)).toThrow(
      'Missing physical table: UnmappedDrift',
    )
  })

  test('fails closed when an actual FK or its pass-two relation is omitted', async () => {
    const schema = await Bun.file(schemaPath).text()
    const missingDirect = manifestCopy()
    const lead = missingDirect.tables.find((entry) => entry.table === 'leads')!
    lead.dependencies = lead.dependencies.filter((dependency) => dependency !== 'price_versions')
    expect(() => validateBackupScopeManifest(schema, missingDirect)).toThrow('Missing FK dependency price_versions for leads')

    const missingDeferred = manifestCopy()
    const reservation = missingDeferred.tables.find((entry) => entry.table === 'lead_admission_reservations')!
    reservation.deferredDependencies = []
    expect(() => validateBackupScopeManifest(schema, missingDeferred)).toThrow(
      'Missing FK dependency lead_submission_keys for lead_admission_reservations',
    )
  })

  test('rejects cross-scope and non-topological dependency declarations', async () => {
    const schema = await Bun.file(schemaPath).text()
    const crossScope = manifestCopy()
    crossScope.tables.find((entry) => entry.table === 'catalog_publications')!.dataScope = 'lead'
    expect(() => validateBackupScopeManifest(schema, crossScope)).toThrow(
      'Core table catalog_state cannot depend on lead table catalog_publications',
    )

    const wrongPass = manifestCopy()
    const reservation = wrongPass.tables.find((entry) => entry.table === 'lead_admission_reservations')!
    reservation.dependencies = ['lead_submission_keys']
    reservation.deferredDependencies = []
    expect(() => validateBackupScopeManifest(schema, wrongPass)).toThrow(
      'Dependency lead_submission_keys must restore before lead_admission_reservations',
    )
  })

  test('keeps crash-safe artifact phases and recovery-budget checks in the Stage 4A migration', async () => {
    const schema = await Bun.file(schemaPath).text()
    const migration = await Bun.file(stage4MigrationPath).text()
    for (const phase of [
      'OBJECTS_VERIFIED',
      'ADMISSION_PUBLISHED',
      'ADMISSION_ACKNOWLEDGED',
      'DENIAL_HEAD_PUBLISHED',
      'DENIAL_DB_ACKNOWLEDGED',
      'ABANDONMENT_RECORD_PUBLISHED',
      'ABANDONMENT_DB_ACKNOWLEDGED',
      'PURGE_RECEIPT_PUBLISHED',
      'PURGE_RECEIPT_DB_ACKNOWLEDGED',
    ]) {
      expect(schema).toContain(phase)
      expect(migration).toContain(phase)
    }
    for (const constraint of [
      'lead_budget_nonnegative',
      'lead_budget_tombstone_conserved',
      'lead_budget_attempt_conserved',
      'lead_budget_checkpoint_conserved',
      'lead_reservation_release_is_clean',
      'backup_artifact_head_phase_proven',
      'backup_artifact_ready_proven',
      'backup_artifact_purge_receipt_proven',
      'backup_artifact_terminal_purge_proven',
      'recovery_provider_scope_is_core',
      'lead_recovery_provider_scope_is_lead',
    ]) {
      expect(migration).toContain(constraint)
    }
  })
})
