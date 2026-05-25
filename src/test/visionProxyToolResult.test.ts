import test from "node:test";
import assert from "node:assert/strict";
import { countRequestImageParts } from "../visionProtocol/visionMessageScan";

test("countRequestImageParts includes screenshot_page tool-result nested PNG", () => {
	const messages = [
		{
			role: "assistant",
			content: [{ callId: "call-1", name: "screenshot_page", input: {} }]
		},
		{
			role: "user",
			content: [
				{
					callId: "call-1",
					content: [{ mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]) }]
				}
			]
		}
	] as any;
	assert.equal(countRequestImageParts(messages), 1);
});
