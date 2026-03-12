import { megarepoJson } from './genie/repo.ts'

/** Megarepo config for livestore */
export default megarepoJson({
  members: {
    /** Primary member */
    'effect-utils': 'overengineeringstudio/effect-utils#schickling/2026-03-08-pnpm-gvs-boundary-spec',

    /** Secondary members */
    'overeng-beads-public': 'overengineeringstudio/overeng-beads-public',
    /** Reference only — not a build dependency */
    effect: 'effect-ts/effect',
  },
})
