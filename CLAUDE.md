# Project-Specific Instructions for Claude

## Setup

This repository uses [`direnv`](https://direnv.net) for automatic environment setup. Run `direnv allow` once, then direnv automatically runs the setup script which installs dependencies and builds TypeScript.

## Zellij (mandatory when working in a zellij session)

- Always check if you are in a zellij session by checking if `$ZELLIJ` is set to any non-empty value.
- Keeping the active tab name accurate is required for every agent session when a zellij session is open; run `zellij action rename-tab "<new-name>"` as soon as you start the task and whenever the focus changes.
- Tab names must stay short, descriptive, and in kebab-case (< 30 characters, abbreviations allowed).
- Describe the current problem/goal and keep names unambiguous within the session; avoid repeating the session name.

## Tooling

- When tools are not directly available in `$PATH`, prefix commands with `direnv exec .` (e.g. `direnv exec . tsc`, `direnv exec . mono lint`)

- For depedency management see @contributor-docs/dependency-management.md

### `mono` CLI

Use the `mono` CLI for common workflows:
- `mono lint` / `mono lint --fix` to run the linting checks
- `mono test <unit|integration|perf>` to run the tests
  - Some tests can take a while to run.
- `mono ts [--watch] [--clean]` to build the TypeScript code
- `mono docs <dev|build|deploy>` for docs workflows
- `mono examples <run|deploy|test>` for example workflows
- ... and more

## Testing

- When working on specific Vitest tests, use the `vitest` CLI directly instead of `mono test` and make sure to target the specific test file and test name: e.g. `vitest run packages/@livestore/common/src/index.test.ts --testNamePattern "should be able to get the number of users"`.

## TypeScript

- Avoid `as any`, force-casting etc as much as possible.
- When writing non-trivial code, make sure to leave some concise code comments explaining the why. (Preferably jsdoc style.)
- When refactoring code you don't need to consider backwards compatibility unless specifically asked for.
- Add helper functions at the end of the file.

## Task-based Approach

### 0. Tasks
- Operate on a task basis. Store all intermediate context in markdown files inside `tasks/{year}/{month}/{branch-name}/{task-id}/` folders.
- Use semantic task ID slugs.

### 1. Research
- Identify existing patterns in the codebase.
- Search external resources if relevant.
- Begin by asking follow-up questions to set the research direction. Avoid trivial questions that you can look up yourself. Already do some preliminary research first to only ask questions that are ambiguous or strategically important.
- Document findings in the `research.md` file.
- When working on a bug/problem, create a separate `problem.md` to document the problem with a detailed description of the problem, the expected behavior, and the actual behavior including clear reproduction steps and evidence (e.g. logs, screenshots, CLI output, etc.).

### 2. Planning
- Review `research.md` in `tasks/<task-id>`.
- Based on the research, create a plan for implementing the user request. Reuse existing patterns, components, and code wherever possible.
- If needed, ask clarifying questions to the user to better understand the scope of the task.
- Write a comprehensive plan in `plan.md`. This plan should include all the context required for an engineer to implement the feature.

### 3. Implementation
- Read `plan.md` and create a to-do list with all required items.
- Execute the plan step by step.
- Continue as far as possible. If ambiguities remain, note all questions at the end and group them together.

## Git

- Before committing, run `direnv exec . mono lint --fix` to auto-fix most linting errors. Make sure there are no type check/lint errors.

### Branch Naming Conventions

- Use descriptive branch names that clearly indicate the purpose: `my-username/feat/add-user-auth`, `my-username/fix/memory-leak`, `my-username/docs/api-reference`
- Keep branch names concise but specific (under 30 characters when possible)
- Use kebab-case for consistency

### Development Workflow

- Run the full test suite before pushing: `direnv exec . mono test unit`
- Ensure TypeScript compilation passes: `direnv exec . mono ts`
- Use `direnv exec . mono lint --fix` to automatically fix formatting issues

### Issues

- When asked to create a GitHub issue, use the GitHub CLI to do so.
- Add appropriate labels to the issue. Only use existing labels, don't create new ones.

### Pull Requests

Describe the pull request in terms of the problem it addresses and the approach it takes—avoid titles like "update tests" that hide the intent. A good title should hint at both the underlying issue and the chosen fix, e.g. `Fix backlog replay flake by stabilizing event helper`. Frame the story around the impact to downstream data consumers or workflows rather than generic "user-facing" language.

Checklist:
- State the problem, solution, and validation steps in the PR body using the template sections.
- Mention any trade-offs or follow-up work the reviewer should know about.
- Research relevant issues and link them to the PR.
- Note which tests were run (or why none were needed).
- Keep the title and description in sync with the current scope as the work evolves—update them whenever the plan shifts.
- Keep CHANGELOG.md up to date with the changes in the PR according to `contributor-docs/changelog-guide.md`.
- Make sure to apply appropriate labels. Don't create new labels, but only reuse existing ones.
- After every substantial change (new commit, merge, or rebase), reread the PR title/body and refresh them before pushing or requesting review.
- When possible, include demo evidence (logs, screenshots, CLI commands, or quick diagrams like Mermaid/ASCII) that demonstrates the change from a data-workflow perspective so reviewers can visualize the impact faster.

### Environment Variables

- Keep sensitive environment variables in `.envrc.local` and never commit them to the repository.

## Documentation / Examples

- It's critical that the documentation and examples are up to date and accurate. When changing code, make sure to update the documentation and examples.
- For code snippets make sure to follow @contributor-docs/docs/snippets.md
