# E2E / Host UI smoke

Host UI automation and in-extension smoke helpers live under `src/e2e/`.

| Path | Role |
|------|------|
| `hostUi/` | Chat scenarios, integration, consistency, probes, fixtures references |
| `driver/` | Node driver (`hostUiSmoke.js` after compile): nut-js, VS Code lifecycle |

## Outputs (not committed)

- Logs and summary: `artifacts/host-ui/`
- Workspace vision tasks: `<workspace>/vision-artifacts/<evidenceSlug>/` (product contract)

## Static fixtures

- `fixtures/host-ui/testButtons/`
- Override: `COPILOT_BRO_UI_SMOKE_TEST_BUTTON_PATH`, `COPILOT_BRO_FIXTURES_ROOT`

## Plans

Execution plans stay in repo-root `plan/` (gitignored). Do not commit `*.plan.md`.

## npm entry

After compile: `node out/e2e/driver/hostUiSmoke.js` (`npm run test:host-ui*`).

Release VSIX excludes `out/e2e/driver/`; smoke commands may still ship inside `out/extension.js` (see README packaging note).
