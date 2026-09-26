/**
 * Normalize user-facing project names for workspace-scoped uniqueness checks.
 * The stored/displayed name is kept as entered; only comparison uses this form.
 */
export function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ')
}

export function projectNameKey(name: string): string {
  return normalizeProjectName(name).toLowerCase()
}

/**
 * Propose a name that is not already present under normalized,
 * case-insensitive comparison. The caller must still ask the user to confirm.
 */
export function suggestUniqueProjectName(base: string, existingNames: readonly string[]): string {
  const normalizedBase = normalizeProjectName(base) || 'Untitled Project'
  const occupied = new Set(existingNames.map(projectNameKey))
  if (!occupied.has(projectNameKey(normalizedBase))) return normalizedBase

  const copySuffix = /^(.*?)(?: Copy(?: \((\d+)\))?)$/iu.exec(normalizedBase)
  const root = copySuffix?.[1] || normalizedBase
  const firstSuggestion = copySuffix ? `${root} Copy (2)` : `${normalizedBase} Copy`
  if (!occupied.has(projectNameKey(firstSuggestion))) return firstSuggestion

  const numbered = /^(.*?)(?: Copy(?: \((\d+)\))?)$/iu.exec(firstSuggestion)
  const numberedRoot = numbered?.[1] || normalizedBase
  let suffix = Number(numbered?.[2] ?? 1) + 1
  let suggestion = `${numberedRoot} Copy (${suffix})`
  while (occupied.has(projectNameKey(suggestion))) {
    suffix += 1
    suggestion = `${numberedRoot} Copy (${suffix})`
  }
  return suggestion
}