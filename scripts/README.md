# Scripts layout

| Directory | Purpose |
|-----------|---------|
| `build/` | `clean-out`, VSIX pack/verify (`package-vsix`, `check-vsix-contents`, `verify-*`) |
| `readme/` | README generation and section parity (`generate-readme`, `readme-section-parity`) |
| `host-ui/` | Real VS Code Host UI smoke entrypoints and helpers |
| *(root)* | `scripts/release-vsix.mjs` — GitHub release + VSIX publish (`npm run release:vsix`) |
| `catalog/` | Model catalog builders (`build-qwen-model-families`, `build-zhipu-model-families`; npm: `catalog:qwen`, `catalog:zhipu`, `catalog:verify`) |
| `dev/` | Disaster recovery / one-off dev tools (vision proxy rebuild, routing header) |
| `lib/` | Shared Node helpers (`repo-root.mjs`) |

npm scripts in `package.json` point at these paths; run from repository root.
