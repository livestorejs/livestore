import type { MutationEvent } from '../../schema/mutations.js'
import type { PreparedBindValues } from '../../utils/util.js'

export type ExecutionBacklogItem =
  | { _tag: 'execute'; query: string; bindValues?: PreparedBindValues }
  | { _tag: 'mutate'; mutationEventEncoded: MutationEvent.Any }
