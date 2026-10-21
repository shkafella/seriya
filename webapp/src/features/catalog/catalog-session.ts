export type PrincipalScopedValue<T> = Readonly<{
  principalId: string
  value: T
}>

export function scopeValueToPrincipal<T>(principalId: string, value: T): PrincipalScopedValue<T> {
  return { principalId, value }
}

export function valueVisibleToPrincipal<T>(
  scoped: PrincipalScopedValue<T> | null,
  principalId: string | null,
): T | null {
  return scoped?.principalId === principalId ? scoped.value : null
}
