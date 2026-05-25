import test from "node:test";
import assert from "node:assert/strict";
import { mapToolPayloadToVisionObject, mapVisionObjectToToolPayload } from "../visionProtocol/mapper";
import { normalizeBatchResult, normalizeGeometry } from "../visionProtocol/normalizer";
import { parseRoiRecordsFromVisionDescription } from "../visionProtocol/roiParser";
import { evaluateRoiConfidenceGate, extractRoiRecordsFromMessages } from "../visionProtocol/roiGate";
import { normalizeRoiRecordToImageBounds, normalizeRoiRecordsToImageBounds, normalizeRotationDegrees } from "../visionProtocol/roiNormalizer";
import type { GeometryProtocol, VisionBatchResult, VisionObject } from "../visionProtocol/types";
import { validateBatchResult, validateGeometry, validateVisionResult } from "../visionProtocol/validator";

test("validateGeometry accepts non-negative boundary coordinates and rejects empty rationale", () => {
	const valid: GeometryProtocol = {
		version: "v1",
		bbox: { x: 0, y: 0, w: 0, h: 0 },
		rationale: "detected from svg candidate"
	};
	assert.equal(validateGeometry(valid), true);
	assert.equal(validateGeometry({
		...valid,
		rationale: ""
	}), false);
	assert.equal(validateGeometry({
		...valid,
		bbox: { x: -1, y: 0, w: 10, h: 10 }
	}), false);
});

test("normalizeGeometry upgrades minimal objects and strips unrelated fields", () => {
	assert.deepEqual(normalizeGeometry({
		x: 12,
		y: 8,
		w: 32,
		h: 16,
		confidence: 0.9,
		rationale: "legacy box",
		extra: "drop"
	}), {
		version: "v1",
		bbox: { x: 12, y: 8, w: 32, h: 16 },
		confidence: 0.9,
		rotationDeg: undefined,
		zIndex: undefined,
		occlusion: undefined,
		textSpan: undefined,
		rationale: "legacy box"
	});

	assert.deepEqual(normalizeGeometry({}), {
		version: "v1",
		bbox: { x: 0, y: 0, w: 0, h: 0 },
		rotationDeg: undefined,
		zIndex: undefined,
		confidence: undefined,
		occlusion: undefined,
		textSpan: undefined,
		rationale: "auto"
	});
});

test("validateBatchResult allows failedRefs while still validating nested results", () => {
	const batch: VisionBatchResult = {
		batchId: "batch-1",
		sessionId: "session-1",
		totalMs: 120,
		failedRefs: ["img-2"],
		results: [
			{
				imageRef: "img-1",
				imageHash: "hash-1",
				processingMs: 100,
				warnings: ["cropped"],
				objects: [
					{
						id: "obj-1",
						label: "button",
						geometry: {
							version: "v1",
							bbox: { x: 0, y: 0, w: 20, h: 10 },
							rationale: "visible ui control"
						},
						rationale: "visible ui control"
					}
				]
			}
		]
	};
	assert.deepEqual(validateBatchResult(batch), []);
	assert.deepEqual(validateVisionResult(batch.results[0]), []);
});

test("normalizeBatchResult tolerates sparse input and preserves warnings and attributes", () => {
	assert.deepEqual(normalizeBatchResult({
		batchId: " batch-2 ",
		sessionId: " session-2 ",
		results: [
			{
				imageRef: " img-1 ",
				imageHash: " hash-1 ",
				processingMs: 40,
				warnings: [" keep ", ""],
				objects: [
					{
						id: " obj-1 ",
						label: " icon ",
						rationale: "legacy rationale",
						bbox: { x: 1, y: 2, w: 3, h: 4 },
						attributes: { source: "legacy" }
					}
				]
			}
		],
		failedRefs: [" img-3 "]
	}), {
		batchId: "batch-2",
		sessionId: "session-2",
		totalMs: 0,
		failedRefs: ["img-3"],
		results: [
			{
				imageRef: "img-1",
				imageHash: "hash-1",
				processingMs: 40,
				warnings: ["keep"],
				objects: [
					{
						id: "obj-1",
						label: "icon",
						geometry: {
							version: "v1",
							bbox: { x: 1, y: 2, w: 3, h: 4 },
							rotationDeg: undefined,
							zIndex: undefined,
							confidence: undefined,
							occlusion: undefined,
							textSpan: undefined,
							rationale: "legacy rationale"
						},
						rationale: "legacy rationale",
						attributes: { source: "legacy" }
					}
				]
			}
		]
	});
});

test("validateGeometry rejects invalid extended fields and accepts valid optional fields", () => {
	const base: GeometryProtocol = {
		version: "v1",
		bbox: { x: 0, y: 0, w: 10, h: 10 },
		rationale: "test"
	};
	// rotationDeg must be finite
	assert.equal(validateGeometry({ ...base, rotationDeg: Number.NaN }), false);
	assert.equal(validateGeometry({ ...base, rotationDeg: 45.5 }), true);
	// zIndex must be finite
	assert.equal(validateGeometry({ ...base, zIndex: Infinity }), false);
	assert.equal(validateGeometry({ ...base, zIndex: 3 }), true);
	// confidence must be non-negative
	assert.equal(validateGeometry({ ...base, confidence: -0.1 }), false);
	assert.equal(validateGeometry({ ...base, confidence: 0.95 }), true);
	// occlusion must be non-negative
	assert.equal(validateGeometry({ ...base, occlusion: -1 }), false);
	assert.equal(validateGeometry({ ...base, occlusion: 0 }), true);
	// textSpan start must be <= end
	assert.equal(validateGeometry({ ...base, textSpan: { start: 10, end: 5 } }), false);
	assert.equal(validateGeometry({ ...base, textSpan: { start: 2, end: 8 } }), true);
	// version must not be empty
	assert.equal(validateGeometry({ ...base, version: "  " }), false);
});

test("validateVisionResult returns errors for missing required fields", () => {
	const validResult = {
		imageRef: "img-1",
		imageHash: "hash-1",
		processingMs: 50,
		objects: [
			{
				id: "obj-1",
				label: "icon",
				geometry: {
					version: "v1",
					bbox: { x: 0, y: 0, w: 5, h: 5 },
					rationale: "detected"
				},
				rationale: "detected"
			}
		]
	};
	assert.deepEqual(validateVisionResult(validResult), []);
	// empty imageRef
	assert.ok(validateVisionResult({ ...validResult, imageRef: "" }).includes("imageRef is required"));
	// empty imageHash
	assert.ok(validateVisionResult({ ...validResult, imageHash: "  " }).includes("imageHash is required"));
	// negative processingMs
	assert.ok(validateVisionResult({ ...validResult, processingMs: -1 }).includes("processingMs must be a non-negative number"));
	// warning with empty string
	assert.ok(validateVisionResult({ ...validResult, warnings: ["valid", ""] }).includes("warnings must contain only non-empty strings"));
	// nested object with invalid geometry triggers nested error
	const invalidObject = { ...validResult.objects[0], geometry: { ...validResult.objects[0].geometry, rationale: "" } };
	const nestedErrors = validateVisionResult({ ...validResult, objects: [invalidObject] });
	assert.ok(nestedErrors.some(e => e.includes("objects[0]")));
});

test("validateBatchResult reports empty batchId or sessionId and empty failedRef strings", () => {
	const validBatch = {
		batchId: "b1",
		sessionId: "s1",
		totalMs: 10,
		failedRefs: [],
		results: []
	};
	assert.deepEqual(validateBatchResult(validBatch), []);
	assert.ok(validateBatchResult({ ...validBatch, batchId: "" }).includes("batchId is required"));
	assert.ok(validateBatchResult({ ...validBatch, sessionId: "" }).includes("sessionId is required"));
	assert.ok(validateBatchResult({ ...validBatch, totalMs: -5 }).includes("totalMs must be a non-negative number"));
	assert.ok(validateBatchResult({ ...validBatch, failedRefs: [""] }).includes("failedRefs must contain only non-empty strings"));
});

test("mapper keeps abstract tool names and rationale when converting round-trip", () => {
	const object: VisionObject = {
		id: "obj-1",
		label: "button",
		geometry: {
			version: "v1",
			bbox: { x: 2, y: 4, w: 20, h: 12 },
			rationale: "matched semantic button region"
		},
		rationale: "matched semantic button region",
		attributes: { role: "primary" }
	};
	const payload = mapVisionObjectToToolPayload("image_segment", object);
	assert.equal(payload.tool, "image_segment");
	assert.equal(payload.rationale, "matched semantic button region");
	assert.equal(payload.objectId, "obj-1");
	assert.deepEqual(mapToolPayloadToVisionObject(payload), {
		...object,
		geometry: {
			version: "v1",
			bbox: { x: 2, y: 4, w: 20, h: 12 },
			rotationDeg: undefined,
			zIndex: undefined,
			confidence: undefined,
			occlusion: undefined,
			textSpan: undefined,
			rationale: "matched semantic button region"
		}
	});
});

test("parseRoiRecordsFromVisionDescription extracts ROIRecord from structured object output", () => {
	const parsed = parseRoiRecordsFromVisionDescription({
		objects: [
			{
				label: "primary button",
				geometry: {
					bbox: { x: 14, y: 22, w: 120, h: 38 },
					rotationDeg: 5,
					confidence: 0.91,
					rationale: "semantic match"
				}
			}
		]
	});

	assert.deepEqual(parsed, [
		{
			bbox: { x: 14, y: 22, w: 120, h: 38 },
			rotationDeg: 5,
			confidence: 0.91,
			rationale: "semantic match",
			targetLabel: "primary button"
		}
	]);
});

test("parseRoiRecordsFromVisionDescription extracts ROIRecord from semi-structured text output", () => {
	const parsed = parseRoiRecordsFromVisionDescription(
		"roi: x=10, y=20, w=30, h=40, confidence=0.66, rotation=12, targetLabel=logo, rationale=corner mark"
	);

	assert.deepEqual(parsed, [
		{
			bbox: { x: 10, y: 20, w: 30, h: 40 },
			confidence: 0.66,
			rotationDeg: 12,
			rationale: "corner mark",
			targetLabel: "logo"
		}
	]);
});

test("extractRoiRecordsFromMessages collects structured and text ROI records", () => {
	const records = extractRoiRecordsFromMessages([
		{
			role: "user",
			content: [
				{ value: "please remove background" },
				{ value: "roi: x=5, y=6, w=7, h=8, confidence=0.8, targetLabel=icon, rationale=mask area" }
			]
		},
		{
			objects: [
				{
					label: "button",
					geometry: {
						bbox: { x: 10, y: 12, w: 40, h: 20 },
						confidence: 0.92,
						rationale: "detected main target"
					}
				}
			]
		}
	]);

	assert.equal(records.length, 2);
	assert.ok(records.some((item) => item.targetLabel === "icon" && item.confidence === 0.8));
	assert.ok(records.some((item) => item.targetLabel === "button" && item.confidence === 0.92));
});

test("evaluateRoiConfidenceGate blocks destructive operations when confidence is below threshold", () => {
	const result = evaluateRoiConfidenceGate({
		messages: [{ role: "user", content: "please remove the logo and replace it" }],
		roiRecords: [
			{ bbox: { x: 1, y: 2, w: 30, h: 15 }, confidence: 0.42, rationale: "weak localization", targetLabel: "logo" }
		],
		certaintyThreshold: 0.7
	});

	assert.equal(result.blocked, true);
	assert.equal(result.destructiveIntent, true);
	assert.equal(result.maxConfidence, 0.42);
	assert.match(result.reason ?? "", /certainty_threshold=0.700/);
});

test("evaluateRoiConfidenceGate does not block non-destructive requests", () => {
	const result = evaluateRoiConfidenceGate({
		messages: [{ role: "user", content: "describe the chart" }],
		roiRecords: [
			{ bbox: { x: 1, y: 2, w: 30, h: 15 }, confidence: 0.2, rationale: "weak localization", targetLabel: "logo" }
		],
		certaintyThreshold: 0.7
	});

	assert.equal(result.blocked, false);
	assert.equal(result.destructiveIntent, false);
});

test("normalizeRoiRecordToImageBounds clips out-of-bound bbox and normalizes rotation", () => {
	const normalized = normalizeRoiRecordToImageBounds(
		{
			bbox: { x: -10, y: 5, w: 300, h: 120 },
			rotationDeg: 450,
			confidence: 0.88,
			rationale: "raw roi",
			targetLabel: "target"
		},
		{ width: 100, height: 80 }
	);

	assert.deepEqual(normalized.bbox, { x: 0, y: 5, w: 100, h: 75 });
	assert.equal(normalized.rotationDeg, 90);
});

test("normalizeRoiRecordsToImageBounds keeps non-negative geometry when bounds are absent", () => {
	const normalized = normalizeRoiRecordsToImageBounds([
		{
			bbox: { x: -5, y: -6, w: 12, h: -3 },
			rotationDeg: -540,
			rationale: "raw"
		}
	]);

	assert.deepEqual(normalized[0].bbox, { x: 0, y: 0, w: 12, h: 0 });
	assert.equal(normalized[0].rotationDeg, -180);
	assert.equal(normalizeRotationDegrees(725), 5);
});

test("B.6 cross-check: structured ROI parse + bounds normalization + confidence gate blocks destructive", () => {
	const roiFromStructured = parseRoiRecordsFromVisionDescription({
		objects: [
			{
				label: "logo",
				geometry: {
					bbox: { x: 90, y: 70, w: 50, h: 40 },
					rotationDeg: 725,
					confidence: 0.35,
					rationale: "low certainty target"
				}
			}
		]
	});

	const normalized = normalizeRoiRecordsToImageBounds(roiFromStructured, { width: 100, height: 80 });
	assert.deepEqual(normalized[0].bbox, { x: 90, y: 70, w: 10, h: 10 });
	assert.equal(normalized[0].rotationDeg, 5);

	const gate = evaluateRoiConfidenceGate({
		messages: [{ role: "user", content: "please remove logo" }],
		roiRecords: normalized,
		certaintyThreshold: 0.7
	});

	assert.equal(gate.destructiveIntent, true);
	assert.equal(gate.blocked, true);
	assert.equal(gate.maxConfidence, 0.35);
});

test("B.6 cross-check: highest confidence ROI keeps destructive request unblocked after normalization", () => {
	const roiRecords = extractRoiRecordsFromMessages([
		{
			role: "user",
			content: [
				{ value: "remove background and keep only icon" },
				{ value: "roi: x=10, y=20, w=30, h=40, confidence=0.62, rotation=450, targetLabel=bg" }
			]
		},
		{
			objects: [
				{
					label: "icon",
					geometry: {
						bbox: { x: 50, y: 10, w: 60, h: 30 },
						confidence: 0.91,
						rotationDeg: -540,
						rationale: "stable detection"
					}
				}
			]
		}
	]);

	const normalized = normalizeRoiRecordsToImageBounds(roiRecords, { width: 90, height: 60 });
	assert.deepEqual(normalized[1].bbox, { x: 50, y: 10, w: 40, h: 30 });
	assert.equal(normalized[0].rotationDeg, 90);
	assert.equal(normalized[1].rotationDeg, -180);

	const gate = evaluateRoiConfidenceGate({
		messages: [{ role: "user", content: "remove background" }],
		roiRecords: normalized,
		certaintyThreshold: 0.7
	});

	assert.equal(gate.blocked, false);
	assert.equal(gate.maxConfidence, 0.91);
	assert.equal(gate.confidenceCount, 2);
});

test("B.6 cross-check: confidence threshold is clamped to [0,1] in gate evaluation", () => {
	const records = [
		{ bbox: { x: 1, y: 1, w: 10, h: 10 }, confidence: 0.4, rationale: "test", targetLabel: "a" }
	];

	const highThreshold = evaluateRoiConfidenceGate({
		messages: [{ role: "user", content: "replace logo" }],
		roiRecords: records,
		certaintyThreshold: 4
	});
	assert.equal(highThreshold.threshold, 1);
	assert.equal(highThreshold.blocked, true);

	const lowThreshold = evaluateRoiConfidenceGate({
		messages: [{ role: "user", content: "replace logo" }],
		roiRecords: records,
		certaintyThreshold: -5
	});
	assert.equal(lowThreshold.threshold, 0);
	assert.equal(lowThreshold.blocked, false);
});