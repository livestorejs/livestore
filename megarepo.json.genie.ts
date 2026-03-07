import { megarepoJson } from './repos/effect-utils/packages/@overeng/genie/src/runtime/megarepo-config/mod.ts'

/** Megarepo config for livestore */
export default megarepoJson({
  members: {
    /** Primary member */
    'effect-utils': 'overengineeringstudio/effect-utils',

    /** Secondary members */
    'overeng-beads-public': 'overengineeringstudio/overeng-beads-public',
    /** Reference only — not a build dependency */
    effect: 'effect-ts/effect',
  },
})