import test from "node:test";
import assert from "node:assert/strict";
import { buildWrapperInstructionText, createWrappedLanguageModelConfig } from "../vscodeLmWrapperShared";

test("createWrappedLanguageModelConfig marks true vscode wrapper identities", () => {
	const config = createWrappedLanguageModelConfig({
		id: "copilot/gpt-4.1",
		name: "GPT-4.1",
		vendor: "copilot",
		family: "gpt",
		maxInputTokens: 200000,
		maxOutputTokens: 16000,
		capabilities: {
			imageInput: true,
			toolCalling: false
		}
	});

	assert.ok(config);
	assert.equal(config?.modelSource, "vscode-lm-wrapper");
	assert.equal(config?.provider, "copilot");
	assert.equal(config?.wrappedLanguageModelId, "copilot/gpt-4.1");
	assert.equal(config?.wrappedLanguageModelVendor, "copilot");
	assert.equal(config?.vision, true);
	assert.equal(config?.toolCalling, false);
	assert.equal(config?.displayName, "GPT-4.1 (Wrapped · copilot)");
	assert.equal(config?.category, "Built-in Wrapper · copilot");
});

test("buildWrapperInstructionText injects preset content", () => {
	const text = buildWrapperInstructionText("Copilot Bro preset prompt: Senior Engineer");

	assert.ok(text);
	assert.match(text ?? "", /Copilot Bro preset prompt: Senior Engineer/);
});

test("buildWrapperInstructionText returns undefined when nothing should be injected", () => {
	assert.equal(buildWrapperInstructionText("  "), undefined);
});