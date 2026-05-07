{ ... }:
{
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
                .parameters |= (del(.allowed_merge_methods) | del(.required_reviewers))
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
