import test from "node:test";
import assert from "node:assert/strict";
import type { LanguageModelChatRequestMessage } from "vscode";
import type { ExtensionSettings } from "../types";
import { applyVisionProcessingAndIntegrityPipeline } from "../providerVisionPipeline";
import { Logger } from "../logger";

function createVisionSettings(strictIntegrity: boolean): Pick<ExtensionSettings, "visionIntegrity" | "visionProcessing"> {
	return {
		visionIntegrity: {
			enabled: true,
			strictIntegrity,
			certaintyThreshold: 0.6,
			checkCount: true,
			checkDimensions: true,
			checkDigest: true,
			trackResize: true,
			trackByteSummary: true,
			roiMode: "full",
			tileMaxPixels: 1024 * 1024,
			detailPriority: "balanced"
		},
		visionProcessing: {
			svgOptimize: false,
			imagePreprocess: true,
			mlSegment: false,
			outputVerbosity: "balanced",
			chatDebugVisibility: true,
			tokenBudgetMode: "balanced",
			needVisionGate: true,
			svgDecisionPolicy: "auto",
			rasterPolicy: "auto",
			spatialSchemaVersion: "1",
			highFidelityPrompt: ""
		}
	};
}

function createImageMessage(data: Uint8Array): LanguageModelChatRequestMessage {
	return {
		role: 2,
		name: "test",
		content: [{
			mimeType: "image/png",
			data
		}]
	} as unknown as LanguageModelChatRequestMessage;
}

test("C.9 provider path triggers processing+integrity and falls back in non-strict mode", async () => {
	const badImage = new Uint8Array(Buffer.from("not-a-real-image"));
	const messages = [createImageMessage(badImage)];
	const logs: Array<Record<string, unknown>> = [];
	const logger = {
		info(_message: string, data?: unknown) {
			if (data && typeof data === "object") {
				logs.push(data as Record<string, unknown>);
			}
		}
	} as unknown as Logger;

	const result = await applyVisionProcessingAndIntegrityPipeline(messages, createVisionSettings(false), logger);

	assert.equal(result.blocked, undefined);
	assert.ok(result.summary?.includes("[Vision] preprocess"));
	assert.ok(result.summary?.includes("images=1"));
	assert.ok(result.summary?.includes("integrity=0/1"));
	assert.ok(result.summary?.includes("fallback=1"));
	assert.equal(result.messages[0], messages[0]);
	assert.ok(logs.some((entry) => entry.integrity_fail_count === 1));
});

test("C.9 provider path blocks downstream in strict integrity mode", async () => {
	const badImage = new Uint8Array(Buffer.from("not-a-real-image"));
	const messages = [createImageMessage(badImage)];
	const logger = { info() {} } as unknown as Logger;

	const result = await applyVisionProcessingAndIntegrityPipeline(messages, createVisionSettings(true), logger);

	assert.equal(result.blocked, true);
	assert.ok(result.blockReason?.includes("integrity_fail_count=1"));
	assert.equal(result.messages[0], messages[0]);
	assert.ok(result.summary?.includes("integrity=0/1"));
});
