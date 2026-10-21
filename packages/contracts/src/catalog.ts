import { z } from 'zod'

import { priceVersionSchema, publicPriceRangeSchema, rubleAmountSchema } from './pricing'

export const catalogRowSchema = z.enum(['lower', 'wall', 'mezzanine', 'accessory'])
export const cutPolicySchema = z.enum(['allowed', 'forbidden'])

export const dimensionsMmSchema = z.object({
  height: z.number().int().positive(),
  width: z.number().int().positive(),
  depth: z.number().int().positive(),
  layoutSpan: z.number().int().positive().optional(),
})

export const consumptionM2Schema = z.object({
  body: z.number().finite().nonnegative(),
  facade: z.number().finite().nonnegative(),
  hdf: z.number().finite().nonnegative(),
})

const hardwareLineSchema = z.object({
  item: z.string().min(1).max(200),
  quantity: z.number().finite().nonnegative().nullable(),
  unit: z.string().min(1).max(30).nullable().optional(),
}).passthrough()

export const catalogSeedFamilySchema = z.object({
  id: z.string().min(1).max(100),
  publicName: z.string().min(1).max(200),
  row: catalogRowSchema,
  cutPolicy: cutPolicySchema,
})

export const catalogSeedModuleSchema = z.object({
  sourceRecordId: z.string().regex(/^catalog-source-\d{4,}$/),
  sku: z.string().min(1).max(100),
  familyId: z.string().min(1).max(100),
  familyName: z.string().min(1).max(200),
  row: catalogRowSchema,
  publicName: z.string().min(1).max(240),
  dimensionsMm: z.object({
    height: z.number().int().positive(),
    width: z.number().int().positive(),
    depth: z.number().int().positive(),
  }),
  layoutSpanMm: z.number().int().positive().optional(),
  heightRule: z.string().min(1),
  consumptionM2: consumptionM2Schema,
  variant: z.record(z.string(), z.unknown()),
  cutToWidth: z.object({
    policy: cutPolicySchema,
    maxReductionMm: z.number().int().positive().nullable(),
    stepMm: z.number().int().positive().nullable(),
  }),
  fasteners: z.object({
    chargeRub: rubleAmountSchema,
    included: z.array(hardwareLineSchema),
    customerSupplied: z.array(hardwareLineSchema),
  }),
  sourceImageUrl: z.string().url().nullable().optional(),
  source: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, {
    message: 'Source traceability must not be empty',
  }),
  review: z.object({
    publicationStatus: z.literal('approved'),
    pending: z.array(z.unknown()).max(0),
  }),
})

export const catalogSeedSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('approved_stage_1'),
  generatedAt: z.union([z.string().date(), z.string().datetime()]),
  source: z.object({
    sourceMap: z.object({
      name: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      recordCount: z.number().int().positive(),
    }),
  }).passthrough(),
  commercialRules: z.object({
    currency: z.literal('RUB'),
    rates: z.object({
      body_rub_m2: z.number().finite().positive(),
      facade_rub_m2: z.number().finite().positive(),
      hdf_rub_m2: z.number().finite().positive(),
      agt_1_rub_m2: z.number().finite().positive(),
      packaging_rub_m2: z.number().finite().positive(),
      customer_price_multiplier: z.literal(1.1),
      included_vat_fraction: z.number().finite().refine(
        (value) => Math.abs(value - 22 / 122) < 1e-12,
        { message: 'included_vat_fraction must represent 22% VAT included in the total' },
      ),
      cut_to_width_service_rub: z.number().finite().positive(),
    }).strict(),
    finalCustomerTotalRoundingRub: z.number().int().positive(),
    vatDisplayAccountantApproved: z.literal(true),
  }).passthrough(),
  materials: z.object({
    body: z.array(z.object({ id: z.string(), name: z.string(), rateRubM2: z.number().finite().positive() })).min(1),
    facade: z.array(z.object({ id: z.string(), name: z.string(), rateRubM2: z.number().finite().positive() })).min(1),
    hdf: z.array(z.object({ id: z.string(), name: z.string(), rateRubM2: z.number().finite().positive() })).min(1),
  }),
  families: z.array(catalogSeedFamilySchema).min(1),
  modules: z.array(catalogSeedModuleSchema).min(1),
})

export const publicCatalogVariantSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().min(1),
  publicName: z.string().min(1),
  dimensionsMm: dimensionsMmSchema,
  cutToWidth: z.object({
    allowed: z.boolean(),
    maxReductionMm: z.number().int().positive().nullable(),
    stepMm: z.number().int().positive().nullable(),
  }),
  assetPath: z.string().startsWith('/catalog/'),
  variant: z.record(z.string(), z.unknown()),
})

export const publicCatalogFamilySchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  publicName: z.string().min(1),
  description: z.string().min(1),
  row: catalogRowSchema,
  purposes: z.array(z.string().min(1)),
  functions: z.array(z.string().min(1)),
  widthsMm: z.array(z.number().int().positive()),
  assetPath: z.string().startsWith('/catalog/'),
  priceRange: publicPriceRangeSchema,
  exclusions: z.array(z.string().min(1)),
  variants: z.array(publicCatalogVariantSchema).min(1),
})

export const publicCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  publicationId: z.string().uuid(),
  releaseId: z.string().min(1).max(120),
  catalogRevision: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  priceVersion: priceVersionSchema,
  families: z.array(publicCatalogFamilySchema).min(1),
})

export const ownerCatalogVariantSchema = z.object({
  id: z.string().uuid(),
  sourceRecordId: z.string().nullable(),
  familyId: z.string().uuid(),
  sku: z.string().min(1),
  publicName: z.string().min(1),
  dimensionsMm: dimensionsMmSchema,
  consumptionM2: consumptionM2Schema,
  fastenerChargeRub: rubleAmountSchema,
  cutPolicy: cutPolicySchema,
  isActive: z.boolean(),
  isComplete: z.boolean(),
  sourceManaged: z.boolean(),
  ownerEditedFields: z.array(z.string()),
  assetId: z.string().uuid().nullable(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
})

export const ownerCatalogAssetSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1),
  publicPath: z.string().startsWith('/catalog/'),
  status: z.enum(['DEVELOPMENT', 'APPROVED', 'REJECTED']),
  productionApproved: z.boolean(),
})

export const ownerCatalogResponseSchema = z.object({
  catalogRevision: z.number().int().nonnegative(),
  activePublicationId: z.string().uuid().nullable(),
  activationState: z.enum(['IDLE', 'MAINTENANCE']),
  publicationStatus: z.enum(['UNPREPARED', 'AWAITING_RELEASE', 'PUBLISHED']),
  hasUnpreparedChanges: z.boolean(),
  priceVersion: priceVersionSchema,
  assets: z.array(ownerCatalogAssetSchema),
  variants: z.array(ownerCatalogVariantSchema),
})

export const ownerCatalogVariantEditSchema = z.object({
  revision: z.number().int().nonnegative(),
  changes: z.object({
    sku: z.string().trim().min(1).max(100).optional(),
    publicName: z.string().trim().min(1).max(240).optional(),
    heightMm: z.number().int().positive().optional(),
    widthMm: z.number().int().positive().optional(),
    depthMm: z.number().int().positive().optional(),
    layoutSpanMm: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
    cutPolicy: cutPolicySchema.optional(),
    assetId: z.string().uuid().nullable().optional(),
  }).strict().refine((changes) => Object.keys(changes).length > 0, {
    message: 'At least one catalog field must change',
  }),
}).strict()

export const ownerCatalogVariantCreateSchema = z.object({
  familyId: z.string().uuid(),
  sku: z.string().trim().min(1).max(100),
  publicName: z.string().trim().min(1).max(240),
  dimensionsMm: dimensionsMmSchema,
  consumptionM2: consumptionM2Schema,
  fastenerChargeRub: rubleAmountSchema,
  cutPolicy: cutPolicySchema,
  assetId: z.string().uuid().nullable(),
  isActive: z.boolean().default(false),
}).strict()

export const catalogReconciliationRecordSchema = z.object({
  sourceRecordId: z.string(),
  sku: z.string(),
  reason: z.string().optional(),
  fields: z.array(z.string()).optional(),
})

export const catalogImportPreviewSchema = z.object({
  schemaVersion: z.literal(1),
  sourcePath: z.string().min(1),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  sourceMapChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  baseCatalogRevision: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
  valid: z.boolean(),
  counts: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    deactivated: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
    invalid: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
  }),
  created: z.array(catalogReconciliationRecordSchema),
  updated: z.array(catalogReconciliationRecordSchema),
  unchanged: z.array(catalogReconciliationRecordSchema),
  deactivated: z.array(catalogReconciliationRecordSchema),
  duplicate: z.array(catalogReconciliationRecordSchema),
  invalid: z.array(catalogReconciliationRecordSchema),
  conflicts: z.array(catalogReconciliationRecordSchema),
})

export const prepareCatalogCandidateResponseSchema = z.object({
  candidateId: z.string().uuid(),
  releaseId: z.string().min(1).max(120),
  catalogRevision: z.number().int().nonnegative(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal('AWAITING_RELEASE'),
})

export type CatalogSeed = z.infer<typeof catalogSeedSchema>
export type CatalogSeedModule = z.infer<typeof catalogSeedModuleSchema>
export type PublicCatalog = z.infer<typeof publicCatalogSchema>
export type PublicCatalogFamily = z.infer<typeof publicCatalogFamilySchema>
export type PublicCatalogVariant = z.infer<typeof publicCatalogVariantSchema>
export type OwnerCatalogResponse = z.infer<typeof ownerCatalogResponseSchema>
export type OwnerCatalogVariantEdit = z.infer<typeof ownerCatalogVariantEditSchema>
export type OwnerCatalogVariantCreate = z.infer<typeof ownerCatalogVariantCreateSchema>
export type CatalogImportPreview = z.infer<typeof catalogImportPreviewSchema>
export type PrepareCatalogCandidateResponse = z.infer<typeof prepareCatalogCandidateResponseSchema>
