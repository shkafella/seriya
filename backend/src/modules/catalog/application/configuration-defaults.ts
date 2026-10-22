import { configurationMetadataSchema, type ConfigurationMetadata } from '@seriya/contracts'

const cornerFamilies = new Set(['lower-corner-sink', 'lower-corner-removable-shelf', 'wall-corner'])
const tallFamilies = new Set(['lower-fridge'])

/** Maps stable family IDs; runtime must never infer these rules from a SKU or a label. */
export function configurationDefaultsForFamily(familyId: string): ConfigurationMetadata {
  if (familyId === 'false-panel') {
    return configurationMetadataSchema.parse({
      role: 'false_panel', straightEligible: true, reservedUpperRows: [],
      falsePanelPositions: ['start', 'between', 'end'], trimLine: null, trimLines: ['plinth', 'crown'],
    })
  }
  if (familyId === 'plinth') {
    return configurationMetadataSchema.parse({
      role: 'plinth', straightEligible: false, reservedUpperRows: [], falsePanelPositions: [], trimLine: 'plinth', trimLines: [],
    })
  }
  if (familyId === 'cornice' || familyId === 'deep-cornice') {
    return configurationMetadataSchema.parse({
      role: 'crown', straightEligible: false, reservedUpperRows: [], falsePanelPositions: [], trimLine: 'crown', trimLines: [],
    })
  }
  if (tallFamilies.has(familyId)) {
    return configurationMetadataSchema.parse({
      role: 'tall', straightEligible: true, reservedUpperRows: ['wall', 'mezzanine'], falsePanelPositions: [], trimLine: null, trimLines: [],
    })
  }
  return configurationMetadataSchema.parse({
    role: 'ordinary', straightEligible: !cornerFamilies.has(familyId), reservedUpperRows: [], falsePanelPositions: [], trimLine: null, trimLines: [],
  })
}
