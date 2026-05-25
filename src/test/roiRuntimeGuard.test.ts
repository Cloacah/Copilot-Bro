import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRoiGateForMessages } from "../visionProtocol/roiRuntimeGuard";

const analyzer = {
	async getMetadata(): Promise<{ width: number; height: number; channels: number }> {
		return { width: 100, height: 80, channels: 4 };
	}
};

test("provider ROI runtime guard blocks destructive low-confidence request with normalized geometry", async () => {
	const result = await evaluateRoiGateForMessages({
		messages: [
			{
				role: "user",
				content: [
					{ value: "please remove the logo" },
					{ mimeType: "image/png", data: new Uint8Array([1, 2, 3, 4]) }
				]
			},
			{
				objects: [
					{
						label: "logo",
						geometry: {
							bbox: { x: 90, y: 70, w: 30, h: 20 },
							rotationDeg: 725,
							confidence: 0.32,
							rationale: "weak localization"
						}
					}
				]
			}
		],
		certaintyThreshold: 0.7,
		analyzer
	});

	assert.equal(result.blocked, true);
	assert.equal(result.destructiveIntent, true);
	assert.deepEqual(result.imageBounds, { width: 100, height: 80 });
	assert.deepEqual(result.normalizedRoiRecords[0]?.bbox, { x: 90, y: 70, w: 10, h: 10 });
	assert.equal(result.normalizedRoiRecords[0]?.rotationDeg, 5);
	assert.equal(result.maxConfidence, 0.32);
});

test("provider ROI runtime guard allows destructive request when highest confidence exceeds threshold", async () => {
	const result = await evaluateRoiGateForMessages({
		messages: [
			{
				role: "user",
				content: [
					{ value: "remove background around icon" },
					{ mimeType: "image/jpeg", data: new Uint8Array([10, 20, 30]) },
					{ value: "roi: x=10, y=12, w=50, h=30, confidence=0.5, targetLabel=bg" }
				]
			},
			{
				objects: [
					{
						label: "icon",
						geometry: {
							bbox: { x: 20, y: 10, w: 40, h: 25 },
							confidence: 0.93,
							rationale: "stable object"
						}
					}
				]
			}
		],
		certaintyThreshold: 0.7,
		analyzer
	});

	assert.equal(result.blocked, false);
	assert.equal(result.destructiveIntent, true);
	assert.equal(result.confidenceCount, 2);
	assert.equal(result.maxConfidence, 0.93);
	assert.equal(result.normalizedRoiRecords.length, 2);
});

test("provider ROI runtime guard cross-validates roi evidence and execution flag consistency", async () => {
	const result = await evaluateRoiGateForMessages({
		messages: [
			{
				role: "user",
				content: [
					{ value: "replace logo with transparent patch" },
					{ mimeType: "image/png", data: new Uint8Array([7, 7, 7, 7]) },
					{ value: "roi: x=4, y=5, w=8, h=9, targetLabel=text, rationale=no confidence" }
				]
			},
			{
				objects: [
					{
						label: "logo",
						geometry: {
							bbox: { x: 10, y: 11, w: 20, h: 12 },
							confidence: 0.66,
							rationale: "moderate confidence"
						}
					}
				]
			}
		],
		certaintyThreshold: 0.7,
		analyzer
	});

	const confidenceFromEvidence = result.normalizedRoiRecords
		.filter((item) => typeof item.confidence === "number" && Number.isFinite(item.confidence) && item.confidence >= 0)
		.map((item) => item.confidence as number);
	const maxConfidenceFromEvidence = confidenceFromEvidence.length > 0 ? Math.max(...confidenceFromEvidence) : undefined;
	const expectedBlocked = result.destructiveIntent
		&& typeof maxConfidenceFromEvidence === "number"
		&& maxConfidenceFromEvidence < result.threshold;

	assert.equal(result.roiCount, result.normalizedRoiRecords.length);
	assert.equal(result.confidenceCount, confidenceFromEvidence.length);
	assert.equal(result.maxConfidence, maxConfidenceFromEvidence);
	assert.equal(result.blocked, expectedBlocked);
});
