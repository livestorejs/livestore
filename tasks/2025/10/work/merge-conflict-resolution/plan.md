# Plan

1. Review current git diff vs upstream reference to understand required updates for Vite plugin integration and Linearlite example.
2. Update relevant example packages (cf-chat, web-linearlite, web-todomvc-sync-cf, and related) to ensure they keep the Cloudflare Vite plugin configuration while aligning with upstream requirements.
3. Ensure Linearlite changes fully embrace new worker integration, adjusting code as needed.
4. Run repository checks (`pnpm biome check` and targeted builds) to confirm changes.
5. Commit updates and prepare PR message via make_pr tool.
