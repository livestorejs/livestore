{ ... }:
{
  # Apply the committed desired ruleset to GitHub (reconcile live <- .github/repo-settings.json).
  # Requires an admin-scoped token in GH_TOKEN (the reconcile workflow provides a GitHub App
  # installation token). Delegates to mono rather than reimplementing the PUT in bash.
  tasks."github:rulesets:sync" = {
    description = "Apply the committed ruleset to GitHub (reconcile)";
    exec = "mono github rulesets sync";
  };

  # Non-mutating preview of what `github:rulesets:sync` would change. Used by the PR plan job.
  tasks."github:rulesets:plan" = {
    description = "Preview ruleset drift without applying (dry-run)";
    exec = "mono github rulesets sync --dry-run";
  };

  # Drift-check the live GitHub App definition against .github/reconcile-app-manifest.json.
  # Requires RECONCILE_APP_ID and RECONCILE_APP_PRIVATE_KEY.
  tasks."github:app:check" = {
    description = "Check the reconcile GitHub App definition against the committed manifest";
    exec = "mono github app check";
  };

  tasks."github:rulesets:check" = {
    description = "Check live GitHub repository rulesets against generated source files";
    exec = ''
      set -euo pipefail
      cd "$DEVENV_ROOT"

      ruleset_file=".github/repo-settings.json"
      ruleset_name="$(jq -r '.name' "$ruleset_file")"
      ruleset_id="$(gh api repos/livestorejs/livestore/rulesets --jq ".[] | select(.name == \"$ruleset_name\") | .id")"

      if [ -z "$ruleset_id" ]; then
        echo "No live ruleset found with name '$ruleset_name'" >&2
        echo "Run 'mono github rulesets sync' with admin permissions to create it." >&2
        exit 1
      fi

      tmp_dir="tmp/gh-rulesets-check"
      mkdir -p "$tmp_dir"

      viewer_permission="$(gh repo view livestorejs/livestore --json viewerPermission --jq '.viewerPermission')"

      jq_normalize='
        {
          name,
          target,
          enforcement,
          bypass_actors: (.bypass_actors // []),
          conditions,
          rules: [
            .rules[]
            | if .type == "pull_request" then
                .parameters |= (
                  del(.allowed_merge_methods)
                  | del(.required_reviewers)
                  | if .dismissal_restriction == { allowed_actors: [], enabled: false } then
                      del(.dismissal_restriction)
                    else
                      .
                    end
                )
              else
                .
              end
          ]
        }
      '

      jq "$jq_normalize" "$ruleset_file" > "$tmp_dir/desired.json"
      gh api "repos/livestorejs/livestore/rulesets/$ruleset_id" --jq "$jq_normalize" > "$tmp_dir/live.json"

      if [ "$viewer_permission" != "ADMIN" ]; then
        jq 'del(.bypass_actors)' "$tmp_dir/desired.json" > "$tmp_dir/desired.visible.json"
        jq 'del(.bypass_actors)' "$tmp_dir/live.json" > "$tmp_dir/live.visible.json"
        mv "$tmp_dir/desired.visible.json" "$tmp_dir/desired.json"
        mv "$tmp_dir/live.visible.json" "$tmp_dir/live.json"
      fi

      if ! diff -u <(jq -S . "$tmp_dir/desired.json") <(jq -S . "$tmp_dir/live.json"); then
        echo "Ruleset '$ruleset_name' drift detected against $ruleset_file." >&2
        echo "Run 'mono github rulesets sync' with admin permissions to reconcile it." >&2
        exit 1
      fi

      echo "Ruleset '$ruleset_name' is in sync with $ruleset_file."
      if [ "$viewer_permission" != "ADMIN" ]; then
        echo "Bypass actor visibility requires repository admin permission; skipped bypass_actors comparison."
      fi
    '';
  };
}
