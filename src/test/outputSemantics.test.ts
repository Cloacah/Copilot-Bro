import test from "node:test";
import assert from "node:assert/strict";
import {
	createChatDebugDetailsText,
	createChatDebugSummary,
	createVisionDetailsText,
	createVisionInputBindingSummary,
	createVisionPreprocessSummary,
	createDisabledVisionContent,
	createPlanOnlyContent,
	createTextFallbackContent,
	createVisionBatchHeader,
	errorMessages,
	formatVisionStructuredThinkingBlock,
	formatVisionStatusText,
	strategyLabels
} from "../toolCooperation/outputSemantics";

test("output semantics expose labels for all six canonical strategies", () => {
	assert.deepEqual(Object.keys(strategyLabels).sort(), ["disabled", "native", "plan-only", "proxy", "text-fallback", "wrapper-proxy"].sort());
	assert.equal(strategyLabels.proxy.en, "Proxy Vision");
	assert.equal(strategyLabels["wrapper-proxy"].zh, "包装代理");
});

test("output semantics build fallback payloads with stable markers", () => {
	assert.match(createPlanOnlyContent("missing tools", "review screenshot"), /\[plan-only\]/);
	assert.match(createTextFallbackContent("no proxy"), /\[text-fallback\]/);
	assert.match(createDisabledVisionContent("compatibility off"), /\[disabled\]/);
	assert.equal(
		createChatDebugDetailsText(createTextFallbackContent("no proxy")),
		[
			"[text-fallback]",
			"reason: no proxy",
			"action: Proceed with the best text-only explanation and call out the missing visual evidence explicitly."
		].join("\n")
	);
	assert.equal(createChatDebugSummary(createDisabledVisionContent("compatibility off")), "[disabled]");
});

test("output semantics centralize vision status, batch headers, and proxy placeholders", () => {
	assert.equal(createVisionBatchHeader("batch-1", "session-1"), "[vision-batch:batch-1] session=session-1");
	assert.equal(
		formatVisionStatusText("failed", "proxy", "proxy unavailable", {
			requestId: "req-1",
			sessionId: "session-1",
			batchId: "batch-1",
			batchIndex: 2
		}, {
			includeSessionId: true,
			includeBatchId: true
		}),
		"[Vision] failed · proxy · req=req-1 · session=session-1 · batch=batch-1#2 · proxy unavailable"
	);
	assert.equal(
		createVisionPreprocessSummary({
			processedCount: 1,
			integrityPassCount: 1,
			integrityFailCount: 0,
			fallbackToOriginalCount: 0,
			warningsCount: 0
		}),
		undefined
	);
	assert.equal(
		createVisionPreprocessSummary({
			processedCount: 2,
			integrityPassCount: 1,
			integrityFailCount: 1,
			fallbackToOriginalCount: 1,
			warningsCount: 2
		}),
		"[Vision] preprocess · images=2 · integrity=1/2 · fallback=1 · warnings=2"
	);
	assert.equal(
		createVisionDetailsText("[Vision] start · proxy · req=e923d1dc · session=session-1 · batch=batch-1#0 · Bro non-vision models with tools available rely on the proxy route."),
		[
			"[Vision] start",
			"route: proxy",
			"request: e923d1dc",
			"session: session-1",
			"batch: batch-1#0",
			"reason: Bro non-vision models with tools available rely on the proxy route."
		].join("\n")
	);
	assert.match(errorMessages.visionProxyUnavailable, /no vision proxy model/);
	assert.match(errorMessages.visionProxyFailed, /failed to describe/);
	assert.match(errorMessages.visionProxyEmpty, /empty description/);
});

test("output semantics unfold vision evidence details inside test harness", () => {
	assert.equal(
		createChatDebugDetailsText([
			"```[Vision Evidence] visual proxy result",
			"mode=image",
			"warnings=none",
			"```"
		].join("\n")),
		[
			"[Vision Evidence] visual proxy result",
			"mode: image",
			"warnings: none"
		].join("\n")
	);
});

test("output semantics summarize vision input binding without raw payload", () => {
	const summary = createVisionInputBindingSummary({
		sourceKind: "tool-result",
		toolName: "screenshot_page",
		imageHash: "0123456789abcdef0123456789abcdef",
		evidenceId: "evidence-1",
		route: "proxy",
		proxyModelId: "claude-sonnet-4.6",
		reused: true,
		rawImageForwarded: false
	});

	assert.equal(
		summary,
		"[Vision] input · source=tool-result · tool=screenshot_page · image=0123456789abcdef · evidence=evidence-1 · route=proxy · proxy=claude-sonnet-4.6 · reused=true · rawImageForwarded=false"
	);
	assert.doesNotMatch(summary, /data:image|base64/i);
});

test("formatVisionStructuredThinkingBlock embeds escaped JSON in details without markdown fences", () => {
	const block = formatVisionStructuredThinkingBlock('{"contract":"vision-proxy-contract-v3","elements":[]}', {
		contract: "vision-proxy-contract-v3",
		elementCount: 2,
		sourceKind: "tool-screenshot",
		toolName: "screenshot_page"
	});
	assert.match(block, /data-extended-models-vision-structured/u);
	assert.match(block, /识图 · 结构化/u);
	assert.match(block, /screenshot_page/u);
	assert.match(block, /data-extended-models-vision-structured/u);
	assert.match(block, /vision-proxy-contract-v3/u);
	assert.doesNotMatch(block, /```/u);
	assert.doesNotMatch(block, /<\/｜｜DSML｜｜/u);
});