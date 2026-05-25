# Vision route order (production)

This document aligns with `src/visionProtocol/visionRoutePipeline.ts` and `src/providerVisionBranch.ts`.

## Pre-route (`runVisionPreRoute`)

1. **processing-and-integrity** — `applyVisionProcessingAndIntegrityPipeline`
2. **roi-gate-pre-route** — `evaluateRoiGateWithTimeout` (`stage: "pre-route"`)

If integrity blocks or pre-route ROI blocks, the request stops before strategy selection.

## Strategy branch (`runVisionStrategyBranch`)

3. **tool-select-route** — `selectTool` → log `vision.route.selected`
4. **strategy-branch** — session/batch planning when images present
5. **proxy-or-native-resolution**
   - **proxy** / **wrapper-proxy**: `resolveVisionProxyMessages`, then **roi-gate-post-proxy** (`stage: "proxy-route"`)
   - **native**: `resolveNativeVisionStructuredMessages` / structured handoff
6. **residual-image-guard** — applied in `provider.ts` after branch returns

## Plan note (R-P2-12)

`VISION_FLOW_MASTER.plan.md` flowcharts may summarize steps; this file is the **implementation order** for code review and Host UI marker expectations.

## Agent session retry (`retryOnFailure`)

`visionAgent.retryOnFailure` drives `agentSession/retryStrategy.shouldRetry` only. It does **not** wrap direct Copilot Chat LM HTTP calls or structured vision HTTP passes (those use `settings.retry`).
