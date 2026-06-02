# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- **Tool / terminal result compaction** — oversized tool outputs are summarized before they enter model context (default when raw text exceeds ~4500 characters): preserves error/signal lines, head/tail, and consecutive duplicate collapse; valid JSON payloads up to ~48k pass through verbatim so structured tools keep working. Applies to all OpenAI-compatible providers via `convertMessages` and to **Wrapped (builtin LM)** transport via `buildCompatibleWrappedChatMessage`. Disable with `COPILOT_BRO_TOOL_RESULT_COMPACT=off`.
- **Request token estimation** — `estimateChatCompletionRequestTokens` accounts for text, images, tool calls, tool results, and tools schema overhead; provider uses it for long-term memory token reservation and context budgeting.
- **Request diagnostics** — optional `request.toolResult.compacted` and `request.messages.footprint` log lines (`COPILOT_BRO_LOG_MESSAGE_FOOTPRINT=1` for per-message footprint).
- **Vision proxy robustness** — when the high-fidelity restore pipeline is suspended, effective handoff is forced to `describe-only`; proxy candidate chain advances on structured-pass failure; last custom-list candidate may accept non-JSON text evidence; image path hydration is limited to the current user turn; format-fallback and text-evidence results are not written to the vision description cache.
- **Vision proxy JSON repair** — post-parse key canonicalization for GLM-style split tokens (e.g. `"element Id"` → `elementId`), split-decimal literal repair (`0 . 91` → `0.91`), and relaxed contract/mode normalization so repaired near-JSON can pass v3 element validation.
- **Vision proxy conversation logs** — `vision-proxy-convo-*.jsonl` under extension global storage (or `COPILOT_BRO_LOG_FILE` / `~/.copilot-bro/logs`); stream-complete records optional preview/full proxy text with env toggles (`COPILOT_BRO_VISION_PROXY_CONVO_LOG_*`); chunk logging off by default.

### Changed

- **Provider context budgeting** — memory injection and pre-request checks use the expanded token estimator instead of text-only heuristics.
- **Thinking-only fallback copy** — when a model ends after extended reasoning without a separate answer, the user-visible hint mentions large tool/terminal buildup and `/compact` where relevant.
- **Zhipu catalog scrape** — scrape [BigModel model docs](https://docs.bigmodel.cn/cn/guide/models/) per-model tab variants and per-tab parameters; hub-only slugs are no longer emitted as callable families (e.g. `GLM-4.1V-Thinking` is represented by `glm-4.1v-thinking-flash` and `glm-4.1v-thinking-flashx`).
- **Zhipu model naming** — date suffixes like `250414` are treated as version ids (not display names) and grouped under stable families (e.g. `GLM 4 FlashX`).
- **Config UI (model vision proxy)** — custom-list selector rows are width-constrained and aligned to the editor grid to avoid overflow.
- **README** — refreshed built-in provider/model examples and updated vision proxy configuration semantics to match the new per-model selection modes.

### Fixed

- **Long tool / terminal output in agent sessions** — repeated oversized command logs no longer crowd out the answer block on thinking models (e.g. DeepSeek) that exhaust output budget after extended reasoning; compaction runs on both provider and Wrapped transports without altering tool-call protocol.
- **Vision proxy GLM structured output** — pathological newlines and token-per-line JSON from Zhipu vision models no longer fail with `at least one visual element is required` after `vision.proxy.format.repaired`; structured v3 evidence can complete on the first successful proxy candidate without relying on text-evidence fallback.
- **Wrapped (builtin) vision routing** — `wrapperProxyAvailable` follows wrapped models when global/model proxy policy is enabled, so the compatibility matrix can select `wrapper-proxy` instead of always degrading.
- **Proxy route mismatch** — when the matrix selects proxy/wrapper-proxy but `resolveVisionProxyMessages` returns `not-needed`, the request now uses matrix fallback instead of silently continuing (which relied on the residual-image guard).
- **Per-model vision proxy `auto`** — `effective.enabled` is `false` when the model has native vision, matching `visionProxyPolicy` `native-default`.

## [0.2.0] - 2026-05-21

### Changed

- **Vision Chat UI** — all vision/debug Chat output goes through `visionChatSurface` as collapsible `<details>` (`LanguageModelTextPart` only); default `chatDebugVisibility` is **false** (no bare `[Vision]` ThinkingPart lines).
- **Vision proxy selection** — global `selectionMode` (`auto` / `fixed` / `custom-list`), ordered `customModelIds`, and per-model rate-limit retries (`customListMaxRetriesPerModel`, `customListMaxDelayMs`); configuration page adds mode picker and custom list editor.
- **README** — removed the placeholder “Screenshots” section; added high-fidelity vision flow diagrams for **native** and **proxy** routes; added a **Visible settings guide** aligned with the configuration page and Phase 1 UI; expanded the generated configuration reference (integrity checks, defaults, restore-pipeline suspension note).
- **Code structure** — split extension smoke/runtime modules, vision structured-pass routing, smoke log bridge, and `scripts/` / `tsconfig` layout (P1–P3 closed).
- **Structured proxy vision** — proxy LM `sendRequest` + stream wrapped with `executeStructuredVisionLmWithRetry` (HTTP retry symmetric with native when `retry.enabled`).
- **Provider transient errors** — Moonshot/OpenAI-compat `error.type` values such as `engine_overloaded` and `rate_limit_exceeded` are retryable.
- **Host UI** — default chat acceptance runs **16** integration scenarios (canonical 17; `p7-chat-benchmark-web-restore` opt-in); stall gate uses executable turns; `p5-qwen-vl-native-chat` uses `native-vision` kind; log evidence validator aligns with live log-watch on `ok:false`.
- **Vision retry** — structured vision pass honors `retry.enabled` (format loop + HTTP attempts).
- **Release VSIX** — `.vscodeignore` excludes all `out/e2e/**`; smoke loads via dynamic `import` of `extensionSmokeActivation` only when `COPILOT_BRO_UI_SMOKE=1` (no static e2e bundle in `extension.js`).
- **npm scripts** — `release:vsix` path fix; `install:vscode` targets 0.2.0; `plan/` tracked in git.

### Added

- Host UI chat acceptance (`npm run test:host-ui:chat-acceptance`, 16 default / 17 canonical) and README generation workflow (`npm run readme:generate` / `readme:check`).
- `npm run catalog:verify` — fails when committed Qwen/Zhipu/Kimi catalog artifacts drift after rebuild.
- `npm run catalog:kimi` — regenerates Kimi/Moonshot families from `resources/kimi-model-cards.json`.
- Dev npm scripts: `catalog:bailian:scrape`, `dev:recover-vision-proxy`, `dev:rebuild-vision-proxy-from-vsix`, `dev:recover-vision-proxy-from-transcript`.
- Unit tests for `secretsStorage`, `visionStructuredRetryPolicy`, and release VSIX `out/e2e/**` deny policy.
- Zhipu **GLM-4.6V FlashX** catalog family; `scripts/catalog/README.md` documents offline + live (`ZHIPU_API_KEY`) regeneration.

### Fixed

- **Vision proxy rate limits** — transient 429/1305 (Zhipu) and `engine_overloaded` (Moonshot) retry on the same model, then advance through custom-list candidates when configured.
- **Vision gate false positives** — file paths or filenames like `image_001.png` in chat text no longer trigger the vision branch or repeated `[Vision] start` UI; only attached image parts (or inline `data:image/...;base64`) count. Proxy route selection and status lines are skipped when no actionable image payload is present (no wasted vision API calls).
- Host UI integration retry now covers **stream-phase** provider errors (429/1305) and advances through `zhipu.vision-native` paid fallbacks (`glm-4.6v-flashx`, `glm-4.6v`).
- `verify-release-vsix.mjs` aligned with dynamic smoke activation (no static `e2e/hostUi/env` require).
- `configPanel` reuses `smokeModeGate` for smoke detection.

### Removed

- Completed tracking plans `plan/CODE_STRUCTURE_OPTIMIZATION.plan.md` and `plan/RISK_AUDIT_AND_REMEDIATION.plan.md` (remediation and structure work are in tree, tests, and `docs/PLAN_COVERAGE.md`).

## [0.1.8] - 2026-05-09

### Changed

- **Vision Settings card** — merged the standalone "Vision Proxy" card and the "Vision Agent Session" phase1 section into a single **识图设置 / Vision Settings** card, with the proxy basic config at the top and the advanced session controls below a divider. Labels are now clearly differentiated ("识图代理基础配置" vs. "识图代理会话").
- **Provider Model Editor** — removed the separate "添加自定义供应商 / 模型" card; all new-model fields are now embedded as a collapsible **"▶ 添加新模型"** section at the bottom of the editor card, keeping the page cleaner by default.
- **Request Tracing** — renamed "请求归属追踪" section to "请求追踪"; removed four runtime-only fields (`requestId`, `sessionId`, `batchId`, `batchIndex`) that were never user-configurable settings; improved help text to explain what the three remaining fields actually do.

### Fixed

- `requestId`, `sessionId`, `batchId`, `batchIndex` no longer appear in `extendedModels.requestAttribution` schema or the settings UI. They remain runtime-generated trace values and are passed programmatically via overrides, not read from user settings.

## [0.1.7] - 2026-05-08

### Added

- Add a **Provider Management** card to the configuration page that lists all registered providers with key status (✓ / ✗), inline `Set Key` buttons for any provider, `Delete Provider` buttons for custom-only providers, and an `Add Provider` input at the bottom.
- Add `Delete Model` button next to the model selector in the model editor; the button only appears for custom (non-built-in) models.
- Expose `contextLength` field in the model editor grid; built-in preset values are labeled "not recommended to change" while custom models can set this freely.
- Add `extendedModels.customProviders` setting (`string[]`) for registering API-key-only providers that have no preset models.
- Allow `Copilot Bro: Set Provider API Key` command to accept an optional provider argument so inline `Set Key` buttons in the provider list open the prompt pre-filled for the selected provider.

## [0.1.6] - 2026-04-30

### Fixed

- Remove Reasoning Effort from model picker tooltip/quick controls to avoid UI-value and persisted-config mismatch.
- Accept more Copilot model-picker configuration field shapes (`reasoningEffort`, `reasoning_effort`, `thinkingEffort`, numeric/string temperature) before persisting quick settings.
- Show installed built-in language models in the vision proxy dropdown even when the stable VS Code API does not expose `imageInput` capability metadata.
- Allow an explicitly selected built-in model to be used as the vision proxy instead of filtering it out due to missing non-public capability metadata.

## [0.1.5] - 2026-04-30

### Fixed

- Stop marking every non-vision model as image-capable in the Copilot model list; only native vision models or models with an explicit model-level vision proxy advertise image input.
- Persist model picker quick configuration changes for reasoning effort and temperature back to `extendedModels.models` when a request is made.
- Replace manual vision proxy model ID inputs with dropdowns populated from native vision presets and installed image-capable Copilot models.
- Restore DeepSeek v4 presets to the 1,048,576 token context window and document model preset source links for future updates.

## [0.1.4] - 2026-04-29

### Added

- Rename the extension UI to Copilot Bro while keeping the existing `extendedModels` configuration namespace for compatibility.
- Add a visible VS Code Settings entry and command for opening the model configuration page directly.
- Add global and per-model vision proxy settings so text-only models can use an image-capable model, including built-in Copilot models, to describe image attachments.
- Add Z.AI vision presets for `glm-5v-turbo`, `glm-4.6v`, and `glm-4.5v`.
- Add model picker quick configuration metadata for reasoning effort and temperature with stable text fallback.
- Add Markdown prompt presets using `*.copilot-bro.prompt.md`, including built-in presets and workspace/global discovery.

### Changed

- Improve configuration page button styling with VS Code theme colors.
- Apply Kimi thinking requests with `keep: "all"` and keep MiniMax `reasoning_split` enabled for separated reasoning streams.
- Improve cross-model history handling by replaying reasoning where required and stripping or trimming provider-private history where it is unsafe.
- Update README screenshots, usage docs, keywords, and install command for Copilot Bro.

## [0.1.3] - 2026-04-29

### Added

- Add MiniMax OpenAI-compatible presets for M2.7, M2.5, M2.1, and M2 with `reasoning_split` enabled for separated reasoning streams.
- Add an Extended Models status-bar token usage estimate because VS Code/Copilot currently reports `0%` native context usage for third-party language model providers.
- Add custom-model UI fields for temperature, top-p, thinking, and reasoning effort.

### Fixed

- Preserve the configuration page's current provider/model selection and scroll position when saving local model overrides.
- Improve token estimation for visible chat content by stripping hidden reasoning metadata before counting and by consuming provider usage chunks when available.
- Strengthen model picker tooltip/detail text with context, output, vision, tools, thinking, temperature, and reasoning-effort metadata while staying on stable VS Code APIs.
- Narrow DeepSeek reasoning-effort choices to the actually meaningful `high` and `max` options, and keep unsupported providers from advertising fake effort choices in built-in hints.

## [0.1.2] - 2026-04-29

### Fixed

- Persist DeepSeek reasoning in a fingerprint-based cache and restore it for prior assistant turns, matching native DeepSeek provider behavior across multi-turn Agent workflows.
- Restore reasoning for non-tool assistant turns when a DeepSeek conversation contains tool history, avoiding second-turn `reasoning_content` API failures.
- Improve token counting for serialized VS Code chat text parts so Copilot's context usage and compaction decisions receive realistic counts.

### Added

- Add additional Zhipu / Z.AI built-in presets including GLM 4.6, GLM 4.5, GLM 4 Plus, GLM 4 Air, and GLM 4 Flash.

## [0.1.1] - 2026-04-29

### Fixed

- Replay DeepSeek `reasoning_content` only for assistant messages that produced tool calls, matching DeepSeek thinking-mode requirements and preventing multi-turn `400 Bad Request` failures.
- Preserve full DeepSeek assistant tool-call messages in memory and repair later Agent history when VS Code stable APIs omit the hidden reasoning/tool-call pairing.
- Drop unrecoverable orphan tool results in DeepSeek thinking mode instead of sending invalid history that the provider rejects.
- Preserve DeepSeek tool-call reasoning through chat-history metadata and rendered thinking blocks on the stable VS Code API path, keeping thinking enabled while restoring the required `reasoning_content` on later Agent turns.
- Read `reasoning_content` from both streamed `delta` chunks and final `choice.message` tool-call chunks, fixing providers that only attach reasoning to the completed assistant message.
- Normalize VS Code/Copilot's `__vscode-...` tool-call ID suffixes before replaying DeepSeek history, so cached reasoning matches later tool results.
- Recover reasoning attached directly to VS Code tool-call parts when present in Copilot chat diagnostics.
- Drop unrecoverable DeepSeek assistant tool-call turns when the true `reasoning_content` is unavailable, instead of sending placeholder reasoning that DeepSeek still rejects.
- Render reasoning as collapsible chat thinking blocks when the stable API path is used, while stripping those blocks before provider replay so they do not become normal assistant content.
- Increase DeepSeek v4 default output budget from 8K to 32K tokens and expose the official larger range, because thinking tokens and final answer tokens share the same output budget.
- Report a practical 200K context window for DeepSeek v4 presets so VS Code's context usage indicator is useful instead of staying at 0% for normal chats.
- Keep DeepSeek reasoning replay metadata out of visible chat output.
- Return immediately after streamed tool-call completion instead of waiting for `[DONE]`, preventing Agent mode timeouts on OpenAI-compatible providers that hold the stream open.
- Use OpenAI-compatible `tool_choice: "required"` for required multi-tool Agent requests, improving tool invocation reliability beyond single-tool cases.
- Treat `requestTimeoutMs` as connection/stream idle timeout instead of total request lifetime, so long but actively streaming complex responses are not aborted at 120 seconds.
- Race provider fetch/stream reads against the timeout explicitly, so timeouts work even when a runtime does not interrupt `ReadableStream.read()` after abort.
- Removed dependency on VS Code proposed APIs so the extension can run after ordinary VSIX / Marketplace installation on VS Code 1.104+.

## [0.1.0] - 2026-04-28

### Added

- Initial VS Code language model provider for Copilot Chat.
- OpenAI-compatible `/chat/completions` streaming support.
- Built-in model presets for DeepSeek, Zhipu / Z.AI, Kimi / Moonshot, and Qwen / DashScope.
- Tool calling support for Agent workflows.
- Vision input support for compatible models.
- Thinking and reasoning stream support for `reasoning_content`, `reasoning`, `thinking`, and XML `<think>` blocks.
- Visual configuration page with local model overrides and custom provider/model creation.
- Local-only API key storage through VS Code `SecretStorage`.
- Sensitive setting filtering and redacted diagnostics.
- Automatic VSIX packaging script.
- GitHub Release upload script via GitHub CLI.

### Security

- API keys are never written to `settings.json`, exported model configuration, README examples, or logs.
- Sensitive fields such as `Authorization`, `apiKey`, `api_key`, `token`, `secret`, `password`, and `cookie` are filtered from model settings and exports.
