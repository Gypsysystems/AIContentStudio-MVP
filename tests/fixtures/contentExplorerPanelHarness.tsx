import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  createContentExplorerFolder,
  hydrateContentExplorerMetadata,
  moveContentExplorerItem,
  type ContentExplorerAssets,
  type ContentExplorerMetadata,
} from '../../src/contentExplorerModel'
import { ContentExplorerPanel } from '../../src/ContentExplorerPanel'

const assets: ContentExplorerAssets = {
  topics: [
    { id: 'topic-welcome', name: 'Welcome' },
    { id: 'topic-setup', name: 'Safe Setup' },
  ],
  snippets: [{ id: 'snippet-caution', name: 'Caution block' }],
  variables: [{ id: 'variable-product', name: 'Product name' }],
  conditions: [{ id: 'condition-premium', name: 'Premium edition' }],
  references: [{ id: 'reference-safety', name: 'Safety reference' }],
}

function initialMetadata(): ContentExplorerMetadata {
  let metadata = hydrateContentExplorerMetadata(null, assets)
  metadata = createContentExplorerFolder(metadata, 'topics', 'Author Guides', 'folder-author-guides')
  metadata = createContentExplorerFolder(metadata, 'folder-author-guides', 'Getting Started', 'folder-getting-started')
  metadata = moveContentExplorerItem(metadata, 'topic', 'topic-setup', 'folder-getting-started')
  metadata = createContentExplorerFolder(metadata, 'snippets', 'Reusable Text', 'folder-reusable-text')
  return metadata
}

function Harness() {
  const [metadata, setMetadata] = useState(initialMetadata)
  const [selectedTopicId, setSelectedTopicId] = useState('topic-welcome')
  const [changes, setChanges] = useState(0)
  const [openedTopic, setOpenedTopic] = useState('')
  const readOnly = new URLSearchParams(window.location.search).get('readOnly') === 'true'

  return (
    <main style={{ display: 'flex', height: '100vh', maxWidth: '100vw', overflow: 'hidden' }}>
      <ContentExplorerPanel
        metadata={metadata}
        assets={assets}
        selectedTopicId={selectedTopicId}
        readOnly={readOnly}
        onOpenTopic={topicId => {
          setSelectedTopicId(topicId)
          setOpenedTopic(topicId)
        }}
        onChange={next => {
          setMetadata(next)
          setChanges(count => count + 1)
        }}
      />
      <div style={{ flex: 1, minWidth: 0, padding: 16 }}>
        <p>Opened topic: <span data-testid="opened-topic">{openedTopic}</span></p>
        <p>Structural changes: <span data-testid="change-count">{changes}</span></p>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)