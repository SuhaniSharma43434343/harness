# Changelog

## 0.1.0 (unreleased)

- M1 interface freeze: open questions decided and recorded in `docs/interfaces.md`. The task board moves from `tasks/` to `board/`, verify logs move to `evidence/tasks/`, and `project.json` gains optional registry, question bank and schema versions.
- T03: project state machine (P0 to P15) with atomic `project.json` saves, an append-only ledger with torn-line repair, and approval enforcement: B1, B2, B3, B6 and B7 gate phase exits, and `requireApproval` refuses and records any action without its approval. `forge new`, `forge approve` and `forge status`.
- T04: task board and runner: dependency-ordered queue with a concurrency limit, per-file locks, a run lock per project, per-attempt timeouts, heartbeats, up to two retries before `blocked`, and `forge resume`, which requeues tasks with a stale heartbeat, discards their uncommitted changes and re-verifies submitted work without re-running the worker.
- T01: CLI skeleton with `--help`, `--version`, `doctor` and `validate`; launchers for macOS/Linux and Windows; config loader with safe defaults; setup scripts.
- T02: runtime schemas for the task contract, plugin manifest, gate result, ledger entry and config, with valid and invalid fixtures and tests.
- T13: project schemas for the brief, facts, question bank, approach registry, selection matrix, approach decision, design decision and rule condition, with valid and invalid fixtures, 7 sample briefs (one per project type) and tests. Project-side function signatures added to `docs/interfaces.md`.
