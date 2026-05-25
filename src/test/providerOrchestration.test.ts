import test from "node:test";
import assert from "node:assert/strict";
import {
	buildAttributionHeaders,
	buildModelCapabilities,
	collectImageRefs,
	createRequestTrace,
	formatVisionStatus
} from "../providerOrchestration";
import { deduplicateRefs, splitIntoBatches } from "../agentSession/batchPlanner";
import type { ExtensionSettings, ModelConfig, RequestAttributionConfig } from "../types";

const MODEL_VISION_PROXY_DISABLED = "__vision_proxy_disabled__";

const baseModel: ModelConfig = {
	id: "test-model",
	provider: "test",
	baseUrl: "https://example.com/v1",
	contextLength: 128000,
	maxOutputTokens: 4096,
	vision: false,
	visionProxyModelId: "proxy-model",
	toolCalling: true,
	headers: {},
	extraBody: {},
	includeReasoningInRequest: false,
	editTools: []
};

const baseSettings: Pick<ExtensionSettings, "visionProxy"> = {
	visionProxy: {
		enabled: true,
		defaultModelId: "builtin-vision",
		customPrompt: "describe"
	}
};

const attributionConfig: RequestAttributionConfig = {
	enabled: true,
	includeSessionId: true,
	includeBatchId: true
};

test("buildModelCapabilities automatically determines vision strategies", () => {
	assert.deepEqual(buildModelCapabilities(baseModel, baseSettings), {
		modelType: "bro",
		nativeVision: false,
		proxyVision: true,
		proxyRequired: true,
		wrapperProxyAvailable: false,
		textFallback: true,
		planOnly: true,
		toolCalling: true
	});
	assert.equal(buildModelCapabilities({
		...baseModel,
		modelSource: "vscode-lm-wrapper",
		wrappedLanguageModelId: "copilot/gpt-4.1",
		wrappedLanguageModelVendor: "copilot",
		visionProxyModelId: null
	}, baseSettings).modelType, "builtin");
});

test("buildModelCapabilities treats sentinel and legacy null string as explicit proxy disable", () => {
	assert.equal(buildModelCapabilities({
		...baseModel,
		vision: false,
		visionProxyModelId: MODEL_VISION_PROXY_DISABLED
	}, baseSettings).proxyVision, false);
	assert.equal(buildModelCapabilities({
		...baseModel,
		vision: false,
		visionProxyModelId: "null"
	}, baseSettings).proxyVision, false);
});

test("buildModelCapabilities treats self-referencing proxy as no proxy", () => {
	const caps = buildModelCapabilities({
		...baseModel,
		vision: true,
		visionProxyModelId: "test-model"
	}, baseSettings);

	assert.equal(caps.nativeVision, true);
	assert.equal(caps.proxyVision, false);
	assert.equal(caps.proxyRequired, false);
});

test("request trace prefers explicit ids and headers follow visibility settings", () => {
	const trace = createRequestTrace(attributionConfig, {
		requestId: "req-fixed",
		sessionId: "session-1",
		batchId: "batch-1",
		batchIndex: 0
	});
	assert.deepEqual(trace, {
		requestId: "req-fixed",
		sessionId: "session-1",
		batchId: "batch-1",
		batchIndex: 0
	});
	assert.deepEqual(buildAttributionHeaders(attributionConfig, trace), {
		"X-Extended-Models-Request-Id": "req-fixed",
		"X-Extended-Models-Session-Id": "session-1",
		"X-Extended-Models-Batch-Id": "batch-1",
		"X-Extended-Models-Batch-Index": "0"
	});
	assert.deepEqual(buildAttributionHeaders({
		...attributionConfig,
		enabled: false
	}, trace), {});
});

test("formatVisionStatus keeps requestId visible and gates session or batch fields by config", () => {
	const trace = {
		requestId: "req-1",
		sessionId: "session-1",
		batchId: "batch-1",
		batchIndex: 2
	};
	assert.equal(
		formatVisionStatus("start", { strategy: "proxy", reason: "proxy available" }, trace, {
			includeSessionId: true,
			includeBatchId: false
		}),
		"[Vision] start · proxy · req=req-1 · session=session-1 · proxy available"
	);
	assert.equal(
		formatVisionStatus("end", { strategy: "wrapper-proxy", reason: "tool wrapper route" }, trace, {
			includeSessionId: false,
			includeBatchId: true
		}),
		"[Vision] end · wrapper-proxy · req=req-1 · batch=batch-1#2 · tool wrapper route"
	);
	const generated = createRequestTrace({
		enabled: true,
		includeSessionId: false,
		includeBatchId: false
	});
	assert.match(generated.requestId, /^[0-9a-f-]{36}$/i);
	assert.equal(generated.sessionId, undefined);
	assert.equal(generated.batchId, undefined);
});

test("collectImageRefs produces hash-addressable refs that batch planning can consume", () => {
	const refs = collectImageRefs([
		{
			role: "user",
			content: [
				{ type: "text", text: "look at this" },
				{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
				{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
				{ type: "image_url", image_url: { url: "https://example.com/screenshot.png" } }
			]
		}
	]);
	assert.equal(refs.length, 3);
	assert.match(refs[0], /\|hash:[0-9a-f]{64}$/i);
	assert.equal(deduplicateRefs(refs, { deduplicateImages: true, dedupeByHash: false }).length, 2);
	assert.deepEqual(splitIntoBatches(refs, 2), [
		[refs[0], refs[1]],
		[refs[2]]
	]);
});

test("single-image repeated calls keep deterministic hashes and can be deduplicated safely", () => {
	const turn1Refs = collectImageRefs([
		{
			role: "user",
			content: [
				{ type: "image_url", image_url: { url: "https://example.com/repeat.png" } }
			]
		}
	]);
	const turn2Refs = collectImageRefs([
		{
			role: "user",
			content: [
				{ type: "text", text: "same image again" },
				{ type: "image_url", image_url: { url: "https://example.com/repeat.png" } }
			]
		}
	]);
	const combined = [...turn1Refs, ...turn2Refs];
	assert.equal(turn1Refs.length, 1);
	assert.equal(turn2Refs.length, 1);
	assert.equal(turn1Refs[0], turn2Refs[0]);
	assert.equal(deduplicateRefs(combined, { deduplicateImages: true, dedupeByHash: false }).length, 1);
});

test("request trace keeps one requestId while batch metadata moves across repeated vision turns", () => {
	const baseTrace = createRequestTrace({
		enabled: true,
		includeSessionId: true,
		includeBatchId: true
	}, {
		requestId: "req-human-e2e",
		sessionId: "session-human-e2e"
	});
	const turn1 = createRequestTrace(attributionConfig, {
		requestId: baseTrace.requestId,
		sessionId: baseTrace.sessionId,
		batchId: "batch-1",
		batchIndex: 0
	});
	const turn2 = createRequestTrace(attributionConfig, {
		requestId: baseTrace.requestId,
		sessionId: baseTrace.sessionId,
		batchId: "batch-2",
		batchIndex: 1
	});

	assert.equal(turn1.requestId, turn2.requestId);
	assert.equal(turn1.sessionId, turn2.sessionId);
	assert.notEqual(turn1.batchId, turn2.batchId);
	assert.equal(turn1.batchIndex, 0);
	assert.equal(turn2.batchIndex, 1);
});