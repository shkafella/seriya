import { z } from 'zod'

import { rubleAmountSchema } from './pricing'

export const kitchenRowSchema = z.enum(['lower', 'wall', 'mezzanine'])
export const configurationRoleSchema = z.enum(['ordinary', 'tall', 'false_panel', 'plinth', 'crown'])
export const falsePanelPositionSchema = z.enum(['start', 'between', 'end'])
export const materialKindSchema = z.enum(['body', 'facade', 'hdf'])

const uuidSchema = z.string().uuid()
const millimetresSchema = z.number().int().nonnegative().max(20_000)

export const configurationMetadataSchema = z.object({
  role: configurationRoleSchema,
  straightEligible: z.boolean(),
  reservedUpperRows: z.array(kitchenRowSchema).max(2),
  falsePanelPositions: z.array(falsePanelPositionSchema).max(3),
  trimLine: z.enum(['plinth', 'crown']).nullable(),
  trimLines: z.array(z.enum(['plinth', 'crown'])).max(2),
}).strict().superRefine((value, context) => {
  if (value.role === 'tall' && value.reservedUpperRows.length === 0) {
    context.addIssue({ code: 'custom', path: ['reservedUpperRows'], message: 'Tall modules must reserve an upper row' })
  }
  if (value.role !== 'tall' && value.reservedUpperRows.length > 0) {
    context.addIssue({ code: 'custom', path: ['reservedUpperRows'], message: 'Only tall modules can reserve upper rows' })
  }
  if (value.role !== 'false_panel' && value.falsePanelPositions.length > 0) {
    context.addIssue({ code: 'custom', path: ['falsePanelPositions'], message: 'Only false panels have false-panel positions' })
  }
  if (value.role !== 'false_panel' && value.trimLines.length > 0) {
    context.addIssue({ code: 'custom', path: ['trimLines'], message: 'Only false panels can extend a trim line' })
  }
  if (value.role === 'plinth' && value.trimLine !== 'plinth') {
    context.addIssue({ code: 'custom', path: ['trimLine'], message: 'Plinth must use the plinth trim line' })
  }
  if (value.role === 'crown' && value.trimLine !== 'crown') {
    context.addIssue({ code: 'custom', path: ['trimLine'], message: 'Crown must use the crown trim line' })
  }
  if (!['plinth', 'crown'].includes(value.role) && value.trimLine !== null) {
    context.addIssue({ code: 'custom', path: ['trimLine'], message: 'Only trim pieces have a trim line' })
  }
})

export const configurationMaterialSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(120),
  kind: materialKindSchema,
  rateRubM2: rubleAmountSchema,
  isActive: z.boolean(),
}).strict()

export const configurationMaterialChoiceSchema = configurationMaterialSchema.omit({ rateRubM2: true })

export const configurationBootstrapVariantSchema = z.object({
  id: uuidSchema,
  familyKey: z.string().min(1).max(100),
  row: z.enum(['lower', 'wall', 'mezzanine', 'accessory']),
  sku: z.string().min(1).max(100),
  publicName: z.string().min(1).max(240),
  dimensionsMm: z.object({ height: z.number().int().positive(), width: z.number().int().positive(), depth: z.number().int().positive(), layoutSpan: z.number().int().positive().optional() }),
  cutToWidth: z.object({ allowed: z.boolean(), maxReductionMm: z.number().int().positive().nullable(), stepMm: z.number().int().positive().nullable() }),
  configuration: configurationMetadataSchema,
}).strict()

export const configurationBootstrapSchema = z.object({
  publicationId: uuidSchema,
  priceVersionId: uuidSchema,
  catalogRevision: z.number().int().nonnegative(),
  materials: z.array(configurationMaterialChoiceSchema).min(1),
  variants: z.array(configurationBootstrapVariantSchema).min(1),
}).strict()

export const quoteModulePlacementSchema = z.object({
  variantId: uuidSchema,
  startMm: millimetresSchema,
  cutWidthMm: z.number().int().positive().max(20_000).nullable(),
  withoutFacade: z.boolean(),
}).strict()

export const quoteRowSchema = z.object({
  row: kitchenRowSchema,
  modules: z.array(quoteModulePlacementSchema).max(30),
}).strict()

export const falsePanelPlacementSchema = z.object({
  variantId: uuidSchema,
  row: kitchenRowSchema,
  startMm: millimetresSchema,
  widthMm: z.number().int().positive().max(20_000),
  position: falsePanelPositionSchema,
}).strict()

export const configurationQuoteRequestSchema = z.object({
  publicationId: uuidSchema,
  intentId: z.string().trim().min(1).max(120),
  wallLengthMm: z.number().int().positive().max(20_000).nullable().optional(),
  bodyMaterialId: z.string().trim().min(1).max(100),
  facadeMaterialId: z.string().trim().min(1).max(100).nullable(),
  facadesIncluded: z.boolean(),
  packagingIncluded: z.boolean(),
  countertopThicknessMm: z.union([z.literal(12), z.literal(20), z.literal(38)]),
  rows: z.array(quoteRowSchema).min(1).max(3),
  falsePanels: z.array(falsePanelPlacementSchema).max(12),
  plinthVariantId: uuidSchema.nullable(),
  crownVariantId: uuidSchema.nullable(),
}).strict().superRefine((value, context) => {
  const seenRows = new Set<string>()
  for (const [index, row] of value.rows.entries()) {
    if (seenRows.has(row.row)) {
      context.addIssue({ code: 'custom', path: ['rows', index, 'row'], message: 'Each row may appear only once' })
    }
    seenRows.add(row.row)
  }
  if (value.facadesIncluded && value.facadeMaterialId === null) {
    context.addIssue({ code: 'custom', path: ['facadeMaterialId'], message: 'Facade material is required when facades are included' })
  }
  if (value.rows.every((row) => row.modules.length === 0)) {
    context.addIssue({ code: 'custom', path: ['rows'], message: 'At least one module is required for a kitchen quote' })
  }
})

export const configurationSpecificationLineSchema = z.object({
  key: z.string().min(1).max(160),
  label: z.string().min(1).max(240),
  quantity: z.number().finite().positive(),
  unit: z.string().min(1).max(30),
  amountRub: rubleAmountSchema,
  customerSupplied: z.boolean(),
}).strict()

export const configurationFreeIntervalSchema = z.object({
  row: kitchenRowSchema,
  startMm: z.number().int().nonnegative(),
  endMm: z.number().int().positive(),
}).strict().refine((value) => value.endMm > value.startMm, { message: 'Free interval must have positive width' })

export const configurationQuoteResponseSchema = z.object({
  publicationId: uuidSchema,
  priceVersionId: uuidSchema,
  intentId: z.string().min(1).max(120),
  configurationFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  totalRub: rubleAmountSchema,
  includedVatRub: rubleAmountSchema,
  kitchenHeightMm: z.number().int().positive(),
  rowSpansMm: z.record(kitchenRowSchema, z.number().int().nonnegative()),
  freeIntervals: z.array(configurationFreeIntervalSchema),
  specification: z.array(configurationSpecificationLineSchema),
  warnings: z.array(z.string().min(1).max(300)),
}).strict()

export const configurationReplacementProposalRequestSchema = z.object({
  publicationId: uuidSchema,
  row: z.enum(['wall', 'mezzanine']),
  selectedIndex: z.number().int().nonnegative(),
  replacementVariantId: uuidSchema,
  wallLengthMm: z.number().int().positive().max(20_000).nullable(),
  rows: z.array(quoteRowSchema).min(1).max(3),
  falsePanels: z.array(falsePanelPlacementSchema).max(12),
}).strict()

export const configurationReplacementChangeSchema = z.object({
  row: z.enum(['wall', 'mezzanine']),
  index: z.number().int().nonnegative(),
  variantId: uuidSchema,
  startMm: z.number().int().nonnegative(),
}).strict()

export const configurationReplacementProposalSchema = z.object({
  requiresConfirmation: z.boolean(),
  changes: z.array(configurationReplacementChangeSchema).min(1).max(2),
}).strict()

export type ConfigurationMetadata = z.infer<typeof configurationMetadataSchema>
export type ConfigurationMaterial = z.infer<typeof configurationMaterialSchema>
export type ConfigurationBootstrap = z.infer<typeof configurationBootstrapSchema>
export type ConfigurationQuoteRequest = z.infer<typeof configurationQuoteRequestSchema>
export type ConfigurationQuoteResponse = z.infer<typeof configurationQuoteResponseSchema>
export type ConfigurationReplacementProposalRequest = z.infer<typeof configurationReplacementProposalRequestSchema>
export type ConfigurationReplacementProposal = z.infer<typeof configurationReplacementProposalSchema>
