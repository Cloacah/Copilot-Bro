import test from "node:test";
import assert from "node:assert/strict";
import { partitionRequestMessageImageParts } from "../visionProtocol/visionMessageScan";

test("partitionRequestMessageImageParts collects nested tool-result images", () => {
	const message = {
		role: "user",
		content: [
			{ value: "see screenshot" },
			{
				callId: "call-1",
				content: [{ mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]) }]
			}
		]
	} as any;

	const { imageParts, otherParts } = partitionRequestMessageImageParts(message);
	assert.equal(imageParts.length, 1);
	assert.equal(otherParts.length, 2);
});

test("partitionRequestMessageImageParts leaves text-only messages empty", () => {
	const message = {
		role: "user",
		content: [{ value: "hello" }]
	} as any;

	const { imageParts, otherParts } = partitionRequestMessageImageParts(message);
	assert.equal(imageParts.length, 0);
	assert.equal(otherParts.length, 1);
});
