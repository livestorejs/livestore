import type * as SyncBackend from '@livestore/sync-cf/cf-worker'
import type { MailboxClientDO } from './MailboxClientDO.ts'
import type { ThreadClientDO } from './ThreadClientDO.ts'

export type CrossStoreEvent =
  | { name: 'v1.ThreadLabelApplied'; data: { threadId: string; labelId: string; appliedAt: Date } }
  | { name: 'v1.ThreadLabelRemoved'; data: { threadId: string; labelId: string; removedAt: Date } }
  | { name: 'v1.ThreadCreated'; data: { id: string; subject: string; participants: string[]; createdAt: Date } }

export type Env = {
  MAILBOX_CLIENT_DO: SyncBackend.CfTypes.DurableObjectNamespace<MailboxClientDO>
  THREAD_CLIENT_DO: SyncBackend.CfTypes.DurableObjectNamespace<ThreadClientDO>
  SYNC_BACKEND_DO: SyncBackend.CfTypes.DurableObjectNamespace<SyncBackend.SyncBackendRpcInterface>
  CROSS_STORE_EVENTS_QUEUE: Queue<CrossStoreEvent>
}
