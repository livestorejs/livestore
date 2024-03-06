import type { PreparedBindValues } from '@livestore/common'
import type { MutationEvent } from '@livestore/common/schema'
export type ExecutionBacklogItem =
  | { _tag: 'execute'; query: string; bindValues?: PreparedBindValues }
  | { _tag: 'mutate'; mutationEventEncoded: MutationEvent.Any }
