import { EventSequenceNumber, type LiveStoreEvent } from '@livestore/livestore'

// Input events (no sequence numbers) - used when committing
const _input: LiveStoreEvent.Input.Decoded = {
  name: 'todoCreated-v1',
  args: { id: 'abc123', text: 'Buy milk' },
}

// Global events (sync backend format) - integer sequence numbers
const _global: LiveStoreEvent.Global.Encoded = {
  name: 'todoCreated-v1',
  args: { id: 'abc123', text: 'Buy milk' },
  seqNum: EventSequenceNumber.Global.make(5),
  parentSeqNum: EventSequenceNumber.Global.make(4),
  clientId: 'client-xyz',
  sessionId: 'session-123',
}

// Client events (local format) - composite sequence numbers
const _client: LiveStoreEvent.Client.Encoded = {
  name: 'todoCreated-v1',
  args: { id: 'abc123', text: 'Buy milk' },
  seqNum: EventSequenceNumber.Client.Composite.make({ global: 5, client: 0, rebaseGeneration: 0 }),
  parentSeqNum: EventSequenceNumber.Client.Composite.make({ global: 4, client: 0, rebaseGeneration: 0 }),
  clientId: 'client-xyz',
  sessionId: 'session-123',
}
