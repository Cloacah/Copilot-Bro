import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
	isVisionProxyConversationLogDisabled,
	isVisionProxyConversationChunkLogEnabled,
	registerCopilotBroLogStoragePath,
	resolveCopilotBroLogDirectory,
	resolveVisionProxyConversationContentMode,
	resolveVisionProxyConversationLogFilePath,
	resolveVisionProxyConversationPreviewLimits
} from "../copilotBroLogPaths";

test("resolveCopilotBroLogDirectory prefers automation log parent", () => {
	const dir = resolveCopilotBroLogDirectory({
		env: { COPILOT_BRO_LOG_FILE: "D:\\logs\\copilot-bro-automation.log" }
	});
	assert.equal(dir, "D:\\logs");
});

test("resolveCopilotBroLogDirectory uses global storage logs when no automation file", () => {
	registerCopilotBroLogStoragePath("C:\\globalStorage\\Cloacah.copilot-bro");
	const dir = resolveCopilotBroLogDirectory({ env: {} });
	assert.equal(dir, path.join("C:\\globalStorage\\Cloacah.copilot-bro", "logs"));
});

test("resolveVisionProxyConversationLogFilePath is default-on under log directory", () => {
	const file = resolveVisionProxyConversationLogFilePath({
		env: { COPILOT_BRO_LOG_FILE: "D:\\logs\\automation.log" },
		now: new Date("2026-05-27T15:49:42.000Z")
	});
	assert.equal(file, path.join("D:\\logs", "vision-proxy-convo-20260527-154942.jsonl"));
});

test("resolveVisionProxyConversationLogFilePath respects disable flag", () => {
	assert.equal(
		resolveVisionProxyConversationLogFilePath({ env: { COPILOT_BRO_VISION_PROXY_CONVO_LOG: "0" } }),
		undefined
	);
	assert.equal(isVisionProxyConversationLogDisabled({ COPILOT_BRO_VISION_PROXY_CONVO_LOG: "off" }), true);
});

test("resolveVisionProxyConversationLogFilePath resolves relative override under log dir", () => {
	const file = resolveVisionProxyConversationLogFilePath({
		env: {
			COPILOT_BRO_LOG_FILE: "D:\\logs\\automation.log",
			COPILOT_BRO_VISION_PROXY_CONVO_LOG_FILE: "custom-convo.jsonl"
		}
	});
	assert.equal(file, path.join("D:\\logs", "custom-convo.jsonl"));
});

test("vision-proxy-convo defaults: chunk logging off, content preview", () => {
	assert.equal(isVisionProxyConversationChunkLogEnabled({}), false);
	assert.equal(resolveVisionProxyConversationContentMode({}), "preview");
});

test("vision-proxy-convo env: chunk logging enabled via truthy values", () => {
	assert.equal(isVisionProxyConversationChunkLogEnabled({ COPILOT_BRO_VISION_PROXY_CONVO_LOG_CHUNKS: "1" }), true);
	assert.equal(isVisionProxyConversationChunkLogEnabled({ COPILOT_BRO_VISION_PROXY_CONVO_LOG_CHUNKS: "true" }), true);
	assert.equal(isVisionProxyConversationChunkLogEnabled({ COPILOT_BRO_VISION_PROXY_CONVO_LOG_CHUNKS: "on" }), true);
	assert.equal(isVisionProxyConversationChunkLogEnabled({ COPILOT_BRO_VISION_PROXY_CONVO_LOG_CHUNKS: "0" }), false);
});

test("vision-proxy-convo env: content mode parsing (none/preview/full)", () => {
	assert.equal(resolveVisionProxyConversationContentMode({ COPILOT_BRO_VISION_PROXY_CONVO_LOG_CONTENT: "none" }), "none");
	assert.equal(resolveVisionProxyConversationContentMode({ COPILOT_BRO_VISION_PROXY_CONVO_LOG_CONTENT: "0" }), "none");
	assert.equal(resolveVisionProxyConversationContentMode({ COPILOT_BRO_VISION_PROXY_CONVO_LOG_CONTENT: "full" }), "full");
	assert.equal(resolveVisionProxyConversationContentMode({ COPILOT_BRO_VISION_PROXY_CONVO_LOG_CONTENT: "preview" }), "preview");
	assert.equal(resolveVisionProxyConversationContentMode({ COPILOT_BRO_VISION_PROXY_CONVO_LOG_CONTENT: "weird" }), "preview");
});

test("vision-proxy-convo env: preview/full limits clamp and defaults", () => {
	const d = resolveVisionProxyConversationPreviewLimits({});
	assert.equal(d.headChars, 2000);
	assert.equal(d.tailChars, 1000);
	assert.equal(d.maxFullChars, 200_000);

	const clamped = resolveVisionProxyConversationPreviewLimits({
		COPILOT_BRO_VISION_PROXY_CONVO_PREVIEW_HEAD_CHARS: "-5",
		COPILOT_BRO_VISION_PROXY_CONVO_PREVIEW_TAIL_CHARS: "99999999",
		COPILOT_BRO_VISION_PROXY_CONVO_MAX_FULL_CHARS: "not-a-number"
	});
	assert.equal(clamped.headChars, 0);
	assert.equal(clamped.tailChars, 50_000);
	assert.equal(clamped.maxFullChars, 200_000);
});
