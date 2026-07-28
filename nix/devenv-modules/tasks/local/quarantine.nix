{ ... }:
{
  # Fails once a quarantine entry's `expires` date passes, forcing a renew-or-remove decision
  # rather than letting a tolerated failure quietly become permanent. Runs against the generated
  # JSON — `scripts/src/shared/quarantine-ledger.ts` is the source of truth, and `lint:check:genie` catches
  # drift between the two.
  #
  # The expiry rule itself lives in `ci-tools` (effect-utils#971), so every repo with a ledger
  # gets the same semantics, including treating a malformed date as expired.
  tasks."quarantine:check" = {
    description = "Check the quarantine ledger for expired or malformed entries";
    exec = "ci-tools quarantine validate --ledger scripts/src/generated/quarantine-ledger.json";
  };
}
