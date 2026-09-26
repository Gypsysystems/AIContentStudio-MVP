import type { ConceptAnalysis } from './conceptAnalysis'
import type { UnsupportedAnalysis } from './unsupportedAnalysis'

type AnalysisSummary = {
  severity: 'warning' | 'info' | 'ready'
  message: string
}

export function analysisSummary(
  analysis: ConceptAnalysis,
  evidenceFresh: boolean,
  analysisFresh: boolean,
  unsupported: UnsupportedAnalysis | null,
  unsupportedFresh: boolean,
): AnalysisSummary {
  if (!evidenceFresh || !analysisFresh || (unsupported && !unsupportedFresh)) {
    return { severity: 'warning', message: 'Evidence or analysis has changed. Refresh the affected checks before using these findings.' }
  }
  const conflicts = analysis.conflicts?.length ?? 0
  const unsupportedCount = unsupported?.findings.length ?? 0
  const gaps = analysis.gaps ?? []
  const actionableGaps = gaps.filter(gap => gap.category !== 'insufficient-coverage').length
  if (conflicts || unsupportedCount || actionableGaps) {
    const details = [
      conflicts && `${conflicts} evidence conflict${conflicts === 1 ? '' : 's'}`,
      unsupportedCount && `${unsupportedCount} unsupported claim${unsupportedCount === 1 ? '' : 's'}`,
      actionableGaps && `${actionableGaps} actionable source gap${actionableGaps === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ')
    return { severity: 'warning', message: `${details}. Review the cited evidence; findings remain available below.` }
  }
  if (gaps.length) {
    return { severity: 'info', message: `${gaps.length} coverage note${gaps.length === 1 ? '' : 's'} for your review. No material blocker was detected.` }
  }
  return { severity: 'ready', message: 'Analysis is current. No material conflicts or coverage problems were detected.' }
}