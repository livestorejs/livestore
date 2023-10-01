import os from 'node:os'
import path from 'node:path'

import dprint from 'dprint-node'

export const pretty = (code: string): string => {
  const tmpPath = os.tmpdir()
  const filePath = path.join(tmpPath, 'tmp.ts')

  return dprint.format(filePath, code, {
    semiColons: 'asi',
    quoteStyle: 'preferSingle',
  })
}
