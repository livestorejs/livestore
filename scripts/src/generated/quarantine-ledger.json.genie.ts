import { jsonArtifact } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/json-artifact/mod.ts'

import { quarantineLedger } from '../../../genie/quarantine-ledger.ts'

export default jsonArtifact({ data: quarantineLedger })
