import {
  canonicalCheckpointJson, verifyCheckpointRecord,
  type ProjectCheckpoint, type ProjectCheckpointSummary,
} from './projectCheckpoint'

/** Reads only the committed record and manifest; archived file bytes are not accessed. */
export async function readValidatedCheckpointRecord(
  projectId: string,
  summary: ProjectCheckpointSummary,
  getCheckpointRecord: (projectId: string, checkpointId: string) => Promise<ProjectCheckpoint | null>,
): Promise<ProjectCheckpoint> {
  if (summary.projectId !== projectId)
    throw new Error('Checkpoint summary does not belong to the selected project.')
  const checkpoint = await getCheckpointRecord(projectId, summary.checkpointId)
  if (!checkpoint) throw new Error('Committed checkpoint record was not found.')
  if (checkpoint.projectId !== projectId)
    throw new Error('Checkpoint record does not belong to the selected project.')
  const { record: _record, ...returnedSummary } = checkpoint
  if (canonicalCheckpointJson(returnedSummary) !== canonicalCheckpointJson(summary))
    throw new Error('Returned checkpoint metadata did not match the committed summary.')
  const verification = await verifyCheckpointRecord(checkpoint)
  if (!verification.valid)
    throw new Error(verification.issues.join(' ') || 'Checkpoint record validation failed.')
  return checkpoint
}