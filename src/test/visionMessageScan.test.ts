import test from "node:test";
import assert from "node:assert/strict";
import {
	countRequestImageParts,
	enumerateVisionImageOccurrences,
	needsVisionFromRequestMessages,
	resolveVisionSourceKind
} from "../visionProtocol/visionMessageScan";
import type { ModelCapabilities } from "../toolCooperation/toolSelector";

const proxyCaps: ModelCapabilities = {
	modelType: "bro",
	nativeVision: false,
	proxyVision: true,
	wrapperProxyAvailable: false,
	textFallback: true,
	planOnly: true,
	toolCalling: true
};

const minPng = { mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]) };

function screenshotPageMessages() {
	return [
		{
			role: "assistant",
			content: [{ callId: "call-1", name: "screenshot_page", input: {} }]
		},
		{
			role: "user",
			content: [{ callId: "call-1", content: [minPng] }]
		}
	] as any;
}

test("resolveVisionSourceKind maps screenshot_page to tool-screenshot", () => {
	assert.equal(resolveVisionSourceKind("tool", "screenshot_page"), "tool-screenshot");
	assert.equal(resolveVisionSourceKind("user"), "user-attachment");
});

test("countRequestImageParts detects images nested in tool results", () => {
	assert.equal(countRequestImageParts(screenshotPageMessages()), 1);
});

test("needsVisionFromRequestMessages is true for screenshot_page tool result images", () => {
	assert.equal(needsVisionFromRequestMessages(screenshotPageMessages(), proxyCaps), true);
});

test("enumerateVisionImageOccurrences binds screenshot_page tool name", () => {
	const occurrences = enumerateVisionImageOccurrences(screenshotPageMessages());
	assert.equal(occurrences.length, 1);
	assert.equal(occurrences[0]?.toolName, "screenshot_page");
	assert.equal(occurrences[0]?.sourceKind, "tool-screenshot");
});

test("needsVisionFromRequestMessages is false when no image bytes are present", () => {
	const messages = [
		{
			role: "user",
			content: [{ value: "describe the screenshot error in logs only" }]
		}
	] as any;
	assert.equal(needsVisionFromRequestMessages(messages, proxyCaps), false);
});
