import { ciWorkflowSupportFiles } from '#mr/effect-utils/genie/ci-workflow.ts'

const patchGitHubArchive503Retry = (script: string) => {
  const replacements = [
    [
      'local log log_dir stdout_pipe stderr_pipe rc path missing_subpath repaired_missing_subpath start now elapsed hb_pid stdout_tee_pid stderr_tee_pid flattened saw_invalid_path saw_cachix_signature saw_fetch_signature saw_daemon_socket_failure saw_missing_flake_subpath missing_subpath_was_repaired had_errexit',
      'local log log_dir stdout_pipe stderr_pipe rc path missing_subpath repaired_missing_subpath start now elapsed hb_pid stdout_tee_pid stderr_tee_pid flattened saw_invalid_path saw_cachix_signature saw_fetch_signature saw_github_archive_503 saw_daemon_socket_failure saw_missing_flake_subpath missing_subpath_was_repaired had_errexit',
    ],
    [
      'saw_fetch_signature=false\n    saw_daemon_socket_failure=false\n    saw_missing_flake_subpath=false',
      'saw_fetch_signature=false\n    saw_github_archive_503=false\n    saw_daemon_socket_failure=false\n    saw_missing_flake_subpath=false',
    ],
    [
      "printf '%s' \"$flattened\" | grep -Eq 'error:[[:space:]]*cannot read file from tarball:[[:space:]]*Truncated tar archive detected while reading data' && saw_fetch_signature=true || true",
      'printf \'%s\' "$flattened" | grep -Eq \'error:[[:space:]]*cannot read file from tarball:[[:space:]]*Truncated tar archive detected while reading data\' && saw_fetch_signature=true || true\n    printf \'%s\' "$flattened" | grep -Eq "unable to download \x27https://api\\\\.github\\\\.com/repos/[^[:space:]\x27]+/tarball/[^[:space:]\x27]+\x27: HTTP error 503|Failed to open archive .*HTTP error 503" && saw_github_archive_503=true || true',
    ],
    [
      'if [ "$saw_invalid_path" != true ] && [ "$saw_cachix_signature" != true ] && [ "$saw_fetch_signature" != true ] && [ "$saw_daemon_socket_failure" != true ] && [ "$saw_missing_flake_subpath" != true ]; then',
      'if [ "$saw_invalid_path" != true ] && [ "$saw_cachix_signature" != true ] && [ "$saw_fetch_signature" != true ] && [ "$saw_github_archive_503" != true ] && [ "$saw_daemon_socket_failure" != true ] && [ "$saw_missing_flake_subpath" != true ]; then',
    ],
    [
      'elif [ "$saw_fetch_signature" = true ]; then\n      echo "::warning::Nix source fetch corruption detected for $task (attempt $attempt/$max); retrying with a refreshed eval cache"',
      'elif [ "$saw_github_archive_503" = true ]; then\n      github_archive_delay_base="${NIX_GITHUB_ARCHIVE_503_BASE_DELAY_SECONDS:-15}"\n      github_archive_delay=$((github_archive_delay_base * attempt + RANDOM % github_archive_delay_base))\n      echo "::warning::GitHub archive fetch returned HTTP 503 for $task (attempt $attempt/$max); retrying after ${github_archive_delay}s backoff"\n      sleep "$github_archive_delay"\n    elif [ "$saw_fetch_signature" = true ]; then\n      echo "::warning::Nix source fetch corruption detected for $task (attempt $attempt/$max); retrying with a refreshed eval cache"',
    ],
  ] as const

  return replacements.reduce((result, [from, to]) => {
    if (result.includes(from) === false) {
      throw new Error(`GitHub archive retry patch no longer matches upstream snippet: ${from}`)
    }
    return result.replace(from, to)
  }, script)
}

const upstream = ciWorkflowSupportFiles.nixGcRaceRetry.output
const data = patchGitHubArchive503Retry(upstream.data)

export default {
  ...upstream,
  data,
  stringify: () => `${data}\n`,
}
