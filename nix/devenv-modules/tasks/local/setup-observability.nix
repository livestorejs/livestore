{ effectUtilsPackages }:
{ pkgs, ... }:
let
  otelite = "${effectUtilsPackages.otelite}/bin/otelite";

  setupProfile = pkgs.writeShellApplication {
    name = "livestore-setup-profile";
    runtimeInputs = [
      pkgs.coreutils
      pkgs.jq
    ];
    text = ''
      target_task="''${LIVESTORE_SETUP_PROFILE_TASK:-setup:strict}"
      task_mode="''${LIVESTORE_SETUP_PROFILE_MODE:-before}"

      if [ -n "''${LIVESTORE_SETUP_TRACE_DIR:-}" ]; then
        capture_dir="$LIVESTORE_SETUP_TRACE_DIR"
      else
        capture_dir="$DEVENV_ROOT/tmp/devenv-traces/setup-$(date -u +%Y%m%dT%H%M%SZ)-$$"
      fi

      mkdir -p "$capture_dir"
      summary_file="$capture_dir/summary.json"
      spans_file="$capture_dir/spans.ndjson"

      # Native devenv tracing uses OTLP/gRPC. Effect-utils' shell task spans use
      # OTLP/HTTP, so route both transports to otelite's isolated receivers.
      # The inner shell expands the otelite-owned endpoint variables.
      # shellcheck disable=SC2016
      env \
        -u DEVENV_TRACE_TO \
        -u OTEL_TASK_TRACEPARENT \
        -u TRACEPARENT \
        ${otelite} run \
          --out "$capture_dir/capture" \
          --protocol grpc \
          -- \
          bash -ceu '
            export OTEL_EXPORTER_OTLP_ENDPOINT="$OTELITE_HTTP_ENDPOINT"
            exec devenv tasks run "$1" \
              --mode "$2" \
              --no-tui \
              --trace-to "otlp-grpc:''${OTELITE_GRPC_ENDPOINT}"
          ' bash "$target_task" "$task_mode" \
          | tee "$summary_file"

      ${otelite} inspect "$capture_dir/capture" --signal traces > "$spans_file"

      jq -e '
        .schema == "otelite.summary/v1"
        and .child.exit_code == 0
        and .counts.rejected == 0
        and .counts.spans > 0
      ' "$summary_file" >/dev/null

      jq -s -e --arg task "$target_task" '
        ([.[].trace_id] | unique | length) == 1
        and any(.[];
          .service == "devenv"
          and .name == "devenv"
          and .parent_span_id == null
        )
        and any(.[];
          .service == "devenv"
          and .name == $task
          and .attrs["devenv.activity.kind"] == "task"
        )
      ' "$spans_file" >/dev/null

      # setup:gate is shared by every setup path. Its Effect-utils execution
      # span must be a child of the native devenv task span, not a second root.
      jq -s -e '
        ([.[] | select(
          .service == "devenv"
          and .name == "setup:gate"
          and .attrs["devenv.activity.kind"] == "task"
        )][0].span_id) as $gate
        | $gate != null
          and any(.[];
            .service == "effect-utils-devenv"
            and .name == "devenv.task.exec"
            and .attrs["task.name"] == "setup:gate"
            and .parent_span_id == $gate
          )
      ' "$spans_file" >/dev/null

      ${otelite} inspect "$capture_dir/capture" --signal traces --summary --pretty
      printf 'Setup trace capture: %s\n' "$capture_dir"
    '';
  };
in
{
  packages = [ setupProfile ];

  tasks."setup:profile" = {
    description = "Capture the strict setup task graph with native devenv OTEL and otelite";
    exec = "${setupProfile}/bin/livestore-setup-profile";
  };

  tasks."test:setup:otel" = {
    description = "Verify native devenv and Effect-utils setup spans form one trace";
    exec = ''
      set -euo pipefail

      test_dir="$(mktemp -d)"
      trap 'rm -rf "$test_dir"' EXIT

      LIVESTORE_SETUP_PROFILE_TASK="setup:gate" \
      LIVESTORE_SETUP_PROFILE_MODE="single" \
      LIVESTORE_SETUP_TRACE_DIR="$test_dir/trace" \
        ${setupProfile}/bin/livestore-setup-profile >/dev/null
    '';
  };
}
