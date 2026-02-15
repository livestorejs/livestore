import { megarepoJson } from './repos/effect-utils/packages/@overeng/genie/src/runtime/megarepo-config/mod.ts'

/** Megarepo config for livestore */
export default megarepoJson({
  members: {
    'effect-utils': 'overengineeringstudio/effect-utils',
    'overeng-beads-public': 'overengineeringstudio/overeng-beads-public',
  },
})
