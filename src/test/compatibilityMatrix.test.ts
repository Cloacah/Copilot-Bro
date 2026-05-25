import test from "node:test";
import assert from "node:assert/strict";
import {
	buildCompatibilityMatrixKey,
	getCompatibilityMatrixEntry,
	selectCompatibilityMatrixStrategy,
	type CompatibilityMatrixInput,
	type CompatibilityModelCapabilities
} from "../toolCooperation/compatibilityMatrix";

const CASES: Array<{ input: CompatibilityMatrixInput; expectedStrategy: string; expectedFallback?: string }> = [
	{ input: { modelType: "builtin", visionCapability: "vision", toolsAvailable: "tools-available", agentEnabled: true }, expectedStrategy: "native" },
	{ input: { modelType: "builtin", visionCapability: "vision", toolsAvailable: "tools-available", agentEnabled: false }, expectedStrategy: "native" },
	{ input: { modelType: "builtin", visionCapability: "vision", toolsAvailable: "no-tools", agentEnabled: true }, expectedStrategy: "native", expectedFallback: "plan-only" },
	{ input: { modelType: "builtin", visionCapability: "vision", toolsAvailable: "no-tools", agentEnabled: false }, expectedStrategy: "native", expectedFallback: "text-fallback" },
	{ input: { modelType: "builtin", visionCapability: "non-vision", toolsAvailable: "tools-available", agentEnabled: true }, expectedStrategy: "wrapper-proxy" },
	{ input: { modelType: "builtin", visionCapability: "non-vision", toolsAvailable: "tools-available", agentEnabled: false }, expectedStrategy: "text-fallback" },
	{ input: { modelType: "builtin", visionCapability: "non-vision", toolsAvailable: "no-tools", agentEnabled: true }, expectedStrategy: "plan-only" },
	{ input: { modelType: "builtin", visionCapability: "non-vision", toolsAvailable: "no-tools", agentEnabled: false }, expectedStrategy: "disabled" },
	{ input: { modelType: "bro", visionCapability: "vision", toolsAvailable: "tools-available", agentEnabled: true }, expectedStrategy: "proxy" },
	{ input: { modelType: "bro", visionCapability: "vision", toolsAvailable: "tools-available", agentEnabled: false }, expectedStrategy: "native" },
	{ input: { modelType: "bro", visionCapability: "vision", toolsAvailable: "no-tools", agentEnabled: true }, expectedStrategy: "proxy", expectedFallback: "plan-only" },
	{ input: { modelType: "bro", visionCapability: "vision", toolsAvailable: "no-tools", agentEnabled: false }, expectedStrategy: "native", expectedFallback: "text-fallback" },
	{ input: { modelType: "bro", visionCapability: "non-vision", toolsAvailable: "tools-available", agentEnabled: true }, expectedStrategy: "proxy" },
	{ input: { modelType: "bro", visionCapability: "non-vision", toolsAvailable: "tools-available", agentEnabled: false }, expectedStrategy: "text-fallback" },
	{ input: { modelType: "bro", visionCapability: "non-vision", toolsAvailable: "no-tools", agentEnabled: true }, expectedStrategy: "plan-only" },
	{ input: { modelType: "bro", visionCapability: "non-vision", toolsAvailable: "no-tools", agentEnabled: false }, expectedStrategy: "disabled" }
];

for (const { input, expectedStrategy, expectedFallback } of CASES) {
	test(`compatibility matrix maps ${buildCompatibilityMatrixKey(input)} -> ${expectedStrategy}`, () => {
		const entry = getCompatibilityMatrixEntry(input);
		assert.equal(entry.strategy, expectedStrategy);
		assert.equal(entry.fallbackStrategy, expectedFallback);
		assert.equal(entry.matrixKey, buildCompatibilityMatrixKey(input));
	});
}

test("matrix-driven selection keeps strategy enums canonical and degrades through declared fallback", () => {
	const caps: CompatibilityModelCapabilities = {
		modelType: "bro",
		nativeVision: true,
		proxyVision: false,
		wrapperProxyAvailable: false,
		textFallback: true,
		planOnly: true,
		toolCalling: false
	};
	const selection = selectCompatibilityMatrixStrategy(true, caps, { enabled: false });

	assert.equal(selection.strategy, "native");
	assert.equal(selection.fallbackStrategy, "text-fallback");
	assert.equal(selection.matrixKey, "bro|vision|no-tools|agent-off");
	assert.match(selection.reason, /native vision/i);
});

test("matrix-driven selection falls back to native vision when proxy is not required", () => {
	const caps: CompatibilityModelCapabilities = {
		modelType: "bro",
		nativeVision: true,
		proxyVision: false,
		wrapperProxyAvailable: false,
		textFallback: true,
		planOnly: true,
		toolCalling: true
	};
	const selection = selectCompatibilityMatrixStrategy(true, caps, { enabled: true });

	assert.equal(selection.strategy, "native");
	assert.equal(selection.matrixKey, "bro|vision|tools-available|agent-on");
	assert.match(selection.reason, /on-model high-fidelity structured path/i);
});

test("matrix-driven selection blocks native bypass when proxy is required", () => {
	const caps: CompatibilityModelCapabilities = {
		modelType: "bro",
		nativeVision: true,
		proxyVision: false,
		proxyRequired: true,
		wrapperProxyAvailable: false,
		textFallback: true,
		planOnly: true,
		toolCalling: true
	};
	const selection = selectCompatibilityMatrixStrategy(true, caps, { enabled: true });

	assert.equal(selection.strategy, "plan-only");
	assert.equal(selection.matrixKey, "bro|vision|tools-available|agent-on");
	assert.doesNotMatch(selection.reason, /native vision/i);
});