# Rollout and operation of contributor meeting publication

Status: accepted. Evidence: maintainer-approved implementation plan and follow-up
interview decisions in the contributor-meeting task, 2026-09-25.

Use the code schedule as operational authority, the docs page as canonical
public information, and Google Calendar as a derived publication. Keep the
public schedule JSON at its established parent path when moving its owning
VRS documentation into this subtree.

Riverside verification checks the stable alias redirects to the intended
reusable Studio URL. Hosted guest entry is not a rollout prerequisite because
it requires host participation without validating the publication machinery.

Back up the publishing credential in shared 1Password. Prove API lifecycle
behavior using a temporary private calendar and clean it up afterward. Report
publication failures in one reusable GitHub issue: reopen for failures, update
on changed failure details, suppress unchanged repeats, close on recovery.

Migrate existing invitees through Calendar notifications. If ending the old
series cannot deliver migration links, update its next occurrence with the
note and notify its invitees before retiring it. Do not require a separate
email or Discord announcement. Once verification passes, activation proceeds
without another discretionary rollout approval.
