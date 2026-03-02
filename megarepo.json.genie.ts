import { megarepoJson } from './repos/effect-utils/packages/@overeng/genie/src/runtime/megarepo-config/mod.ts'

/** Megarepo config for livestore */
export default megarepoJson({
  members: {
    /** Primary member — build dependency that receives PRs during alignment. */
    'effect-utils': 'overengineeringstudio/effect-utils',

    /** Secondary members — consumed via lock files but never modified during alignment. */
    'overeng-beads-public': 'overengineeringstudio/overeng-beads-public',
    /** Reference only — not a build dependency */
    effect: 'effect-ts/effect',
  },
})