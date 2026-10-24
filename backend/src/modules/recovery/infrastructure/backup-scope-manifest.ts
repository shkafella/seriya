export type BackupDataScope = 'core' | 'lead'

export type BackupScopeTable = {
  table: string
  schemaArtifact: 'core'
  dataScope: BackupDataScope
  restoreOrder: number
  dependencies: readonly string[]
  deferredDependencies: readonly string[]
  countQuery: string
  checksumQuery: string
}

function table(
  tableName: string,
  dataScope: BackupDataScope,
  restoreOrder: number,
  dependencies: readonly string[] = [],
  deferredDependencies: readonly string[] = [],
): BackupScopeTable {
  const quoted = `"${tableName.replaceAll('"', '""')}"`
  return {
    table: tableName,
    schemaArtifact: 'core',
    dataScope,
    restoreOrder,
    dependencies,
    deferredDependencies,
    countQuery: `SELECT count(*)::bigint AS row_count FROM ${quoted}`,
    checksumQuery: `SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) AS checksum FROM ${quoted} AS t`,
  }
}

export const backupScopeManifest = {
  schemaVersion: 1,
  stage: '4A',
  grantAttestationAlgorithm: 'sha256-canonical-pg-catalog-v1',
  tables: [
    table('_prisma_migrations', 'core', 1),
    table('users', 'core', 2),
    table('owner_identities', 'core', 3, ['users']),
    table('auth_sessions', 'core', 4, ['users']),
    table('catalog_assets', 'core', 5),
    table('catalog_source_records', 'core', 6),
    table('catalog_families', 'core', 7, ['catalog_assets']),
    table('catalog_variants', 'core', 8, ['catalog_assets', 'catalog_families', 'catalog_source_records']),
    table('price_versions', 'core', 9),
    table('pricing_state', 'core', 10, ['price_versions']),
    table('price_drafts', 'core', 11, ['price_versions']),
    table('catalog_import_history', 'core', 12),
    table('catalog_edit_history', 'core', 13, ['catalog_variants']),
    table('catalog_publications', 'core', 14, ['price_versions']),
    table('catalog_state', 'core', 15, ['catalog_publications']),
    table('catalog_activation_attempts', 'core', 16, ['catalog_publications']),
    table('lead_policy_versions', 'core', 17),
    table('lead_policy_transition_operations', 'core', 18, ['lead_policy_versions']),
    table('lead_policy_transition_commands', 'core', 19, ['lead_policy_transition_operations']),
    table('lead_policy_state', 'core', 20, ['lead_policy_versions']),
    table('lead_policy_transition_state', 'core', 21, ['lead_policy_transition_commands', 'lead_policy_transition_operations']),
    table('lead_policy_candidate_withdrawals', 'core', 22, ['lead_policy_versions', 'users']),
    table('backup_snapshot_generations', 'core', 23),
    table('backup_artifacts', 'core', 24, ['backup_snapshot_generations'], ['backup_artifacts']),
    table('lead_protection_state', 'core', 25, ['backup_artifacts']),
    table('lead_policy_protection_attestations', 'core', 26, ['lead_policy_versions', 'lead_protection_state']),
    table('crypto_version_state', 'core', 27),
    table('recovery_provider_operation_fences', 'core', 28),
    table('recovery_control_chain_state', 'core', 29),
    table('recovery_high_water_checkpoint_state', 'core', 30),
    table('active_host_epoch_transitions', 'core', 31, ['recovery_provider_operation_fences']),
    table('lead_recovery_provider_operation_fences', 'lead', 32),
    table('lead_admission_budget_state', 'lead', 33),
    table('lead_admission_reservations', 'lead', 34, [], ['lead_submission_keys']),
    table('leads', 'lead', 35, ['catalog_publications', 'lead_policy_versions', 'price_versions']),
    table('lead_submission_keys', 'lead', 36, ['lead_admission_reservations', 'leads']),
    table('lead_submission_intents', 'lead', 37, ['lead_submission_keys']),
    table('lead_status_history', 'lead', 38, ['leads', 'users']),
    table('lead_notifications', 'lead', 39, ['leads']),
    table('lead_erasure_receipts', 'lead', 40),
    table('lead_erasure_requests', 'lead', 41, ['leads']),
    table('lead_erasure_marker_attempts', 'lead', 42, ['lead_admission_reservations', 'lead_erasure_requests']),
    table('submission_key_abandonment_batches', 'lead', 43),
    table('submission_key_abandonment_attempts', 'lead', 44, ['lead_admission_reservations', 'lead_submission_keys', 'submission_key_abandonment_batches']),
  ],
} as const

type ForeignKey = { childTable: string; parentTable: string; nullable: boolean }

function extractModels(schemaSource: string) {
  const models = [...schemaSource.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
    .map((match) => ({ name: match[1]!, body: match[2]! }))
  const known = new Set(models.map((model) => model.name))
  for (const match of schemaSource.matchAll(/^model\s+(\w+)\s*\{([^\r\n}]*)\}\s*$/gm)) {
    if (!known.has(match[1]!)) models.push({ name: match[1]!, body: match[2]! })
  }
  return models
}

function extractForeignKeys(schemaSource: string): ForeignKey[] {
  const models = extractModels(schemaSource)
  const tableByModel = new Map(models.map((model) => {
    const mapped = model.body.match(/@@map\("([^"]+)"\)/)?.[1]
    return [model.name, mapped ?? model.name] as const
  }))
  const relations = new Map<string, ForeignKey>()

  for (const model of models) {
    const childTable = tableByModel.get(model.name)!
    for (const line of model.body.split(/\r?\n/)) {
      const relation = line.match(/^\s*\w+\s+(\w+)(\?)?\s+@relation\([^)]*fields:\s*\[[^\]]+\]/)
      if (!relation) continue
      const parentTable = tableByModel.get(relation[1]!)
      if (!parentTable) continue
      const key = `${childTable}\0${parentTable}`
      const nullable = relation[2] === '?'
      const previous = relations.get(key)
      relations.set(key, { childTable, parentTable, nullable: previous ? previous.nullable && nullable : nullable })
    }
  }

  return [...relations.values()]
}

export function validateBackupScopeManifest(
  schemaSource: string,
  manifest: { tables: readonly BackupScopeTable[] } = backupScopeManifest,
) {
  const expectedPrismaTables = extractModels(schemaSource)
    .map((model) => model.body.match(/@@map\("([^"]+)"\)/)?.[1] ?? model.name)
  const expectedTables = new Set(['_prisma_migrations', ...expectedPrismaTables])
  const entries = manifest.tables
  const actualTables = new Set(entries.map((entry) => entry.table))
  const errors: string[] = []

  if (actualTables.size !== entries.length) errors.push('Every physical table must occur exactly once')
  for (const tableName of expectedTables) {
    if (!actualTables.has(tableName)) errors.push(`Missing physical table: ${tableName}`)
  }
  for (const tableName of actualTables) {
    if (!expectedTables.has(tableName)) errors.push(`Unknown physical table: ${tableName}`)
    if (/share/i.test(tableName)) errors.push(`Stage 4A must not contain share table: ${tableName}`)
  }

  const order = entries.map((entry) => entry.restoreOrder)
  if (new Set(order).size !== order.length || order.some((value, index) => value !== index + 1)) {
    errors.push('Restore order must be unique and contiguous')
  }

  const scopeByTable = new Map(entries.map((entry) => [entry.table, entry.dataScope]))
  const orderByTable = new Map(entries.map((entry) => [entry.table, entry.restoreOrder]))
  const foreignKeys = extractForeignKeys(schemaSource)
  const foreignKeysByChild = new Map<string, ForeignKey[]>()
  for (const foreignKey of foreignKeys) {
    foreignKeysByChild.set(foreignKey.childTable, [
      ...(foreignKeysByChild.get(foreignKey.childTable) ?? []),
      foreignKey,
    ])
  }
  for (const entry of entries) {
    if (!entry.countQuery.includes(`"${entry.table}"`) || !entry.checksumQuery.includes(`"${entry.table}"`)) {
      errors.push(`Count/checksum query mismatch: ${entry.table}`)
    }
    const declaredDependencies = [...entry.dependencies, ...entry.deferredDependencies]
    const expectedDependencies = (foreignKeysByChild.get(entry.table) ?? []).map((item) => item.parentTable)
    for (const dependency of expectedDependencies) {
      if (!declaredDependencies.includes(dependency)) errors.push(`Missing FK dependency ${dependency} for ${entry.table}`)
    }
    for (const dependency of declaredDependencies) {
      if (!actualTables.has(dependency)) errors.push(`Unknown dependency ${dependency} for ${entry.table}`)
      if (!expectedDependencies.includes(dependency)) errors.push(`Unexpected dependency ${dependency} for ${entry.table}`)
      if (entry.dataScope === 'core' && scopeByTable.get(dependency) === 'lead') {
        errors.push(`Core table ${entry.table} cannot depend on lead table ${dependency}`)
      }
    }
    for (const dependency of entry.dependencies) {
      if ((orderByTable.get(dependency) ?? Number.POSITIVE_INFINITY) >= entry.restoreOrder) {
        errors.push(`Dependency ${dependency} must restore before ${entry.table}`)
      }
    }
    for (const dependency of entry.deferredDependencies) {
      const foreignKey = (foreignKeysByChild.get(entry.table) ?? [])
        .find((item) => item.parentTable === dependency)
      if (foreignKey && !foreignKey.nullable) {
        errors.push(`Deferred dependency ${dependency} for ${entry.table} must be nullable`)
      }
      if (dependency !== entry.table && (orderByTable.get(dependency) ?? 0) < entry.restoreOrder) {
        errors.push(`Deferred dependency ${dependency} for ${entry.table} already restores earlier`)
      }
    }
  }

  if (errors.length > 0) throw new Error(errors.join('\n'))
  return manifest
}
