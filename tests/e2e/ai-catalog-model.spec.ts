import { expect, test } from '@playwright/test'
import {
  canTransitionAiVersion,
  validateAiAssetInput,
  validateAiRevision,
  validateAiTransition,
  type AiAssetVersion,
  type AiAssetInput,
  type PromptPackDefinition,
} from '../../src/aiCatalogModel'

const pack: AiAssetInput = {
  kind: 'prompt-pack',
  name: 'Grounded drafts',
  description: 'Instructions for evidence-backed writing',
  definition: {
    prompts: [{ id: 'prompt-1', version: 1, state: 'draft', name: 'Outline', template: 'Use {{evidence}}.', variables: ['evidence'] }],
  },
}
const previous: AiAssetVersion = {
  ...pack,
  id: 'pack-1', workspaceId: 'workspace-1', version: 1, state: 'draft',
  createdAt: '2026-09-26T00:00:00Z', createdBy: 'user-1',
}

test('prompt versions retain stable IDs and cannot silently rewrite an earlier version', () => {
  expect(validateAiAssetInput(pack)).toBe(true)
  expect(validateAiRevision(previous, { ...pack, definition: { prompts: [
    { id: 'prompt-1', version: 1, state: 'draft', name: 'Outline', template: 'Rewritten', variables: ['evidence'] },
  ] } })).toBe(false)
  expect(validateAiRevision(previous, { ...pack, definition: { prompts: [
    { id: 'prompt-1', version: 2, state: 'test', name: 'Outline', template: 'Revised', variables: ['evidence'] },
  ] } })).toBe(true)
  expect(validateAiRevision(previous, { ...pack, definition: { prompts: [
    { id: 'prompt-1', version: 3, state: 'published', name: 'Outline', template: 'Skipped version', variables: ['evidence'] },
  ] } })).toBe(false)
})

test('draft, test and published transitions do not mutate a published snapshot', () => {
  expect(canTransitionAiVersion('draft', 'test')).toBe(true)
  expect(canTransitionAiVersion('test', 'published')).toBe(true)
  expect(canTransitionAiVersion('published', 'draft')).toBe(false)
  expect(validateAiTransition(previous, 'published')).toBe(false)
  expect(validateAiTransition({
    ...previous,
    definition: { prompts: [{ ...(pack.definition as PromptPackDefinition).prompts[0], state: 'published' }] },
  }, 'published')).toBe(true)
})

test('definition payloads reject arbitrary credential fields and oversized embedded document content', () => {
  expect(validateAiAssetInput({ ...pack, apiKey: 'secret' })).toBe(false)
  expect(validateAiAssetInput({ ...pack, definition: { ...pack.definition, credentials: {} } })).toBe(false)
  expect(validateAiAssetInput({
    kind: 'reference-set', name: 'Evidence', description: '', definition: {
      entries: [{ id: 'term-1', type: 'terminology', title: 'Term', locator: 'file-1', note: 'x'.repeat(1001) }],
    },
  })).toBe(false)
  expect(validateAiAssetInput({
    kind: 'blueprint', name: 'Quick Start', description: '', definition: {
      contentType: 'Quick Start', sections: [{ id: 'intro', title: 'Introduction', required: true, rules: ['Keep it concise.'] }],
    },
  })).toBe(true)
})