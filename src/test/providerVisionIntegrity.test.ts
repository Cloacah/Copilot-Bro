import test from "node:test";
import assert from "node:assert/strict";
import { isImageInputPart, replaceImageInputPartData, validateImageIntegrity } from "../providerVisionIntegrity";

const baseSettings = {
	visionIntegrity: {
		enabled: true,
		strictIntegrity: false,
		certaintyThreshold: 0.7,
		checkCount: true,
		checkDimensions: true,
		checkDigest: true,
		trackResize: true,
		trackByteSummary: true,
		roiMode: "full" as const,
		tileMaxPixels: 4_194_304,
		detailPriority: "balanced" as const
	}
};

test("validateImageIntegrity emits normalized warning codes", () => {
	const original = Buffer.from([1, 2, 3, 4]);
	const candidate = Buffer.alloc(0);
	const warnings = validateImageIntegrity(
		baseSettings,
		original,
		candidate,
		"orig-digest",
		"",
		{ width: 10, height: 10 },
		{ width: 0, height: 0 }
	);

	assert.ok(warnings.includes("integrity:empty_image"));
	assert.ok(warnings.includes("integrity:invalid_dimensions"));
});

test("validateImageIntegrity reports growth and resize drift with normalized codes", () => {
	const original = Buffer.from([1, 2, 3, 4]);
	const candidate = Buffer.alloc(original.length * 9, 1);
	const warnings = validateImageIntegrity(
		baseSettings,
		original,
		candidate,
		"same-digest",
		"same-digest",
		{ width: 10, height: 10 },
		{ width: 60, height: 45 }
	);

	assert.ok(warnings.includes("integrity:abnormal_dimension_growth"));
	assert.ok(warnings.includes("integrity:abnormal_byte_growth"));
	assert.ok(warnings.includes("integrity:resize_metadata_drift"));
});

test("replaceImageInputPartData only mutates image data field", () => {
	const part = {
		mimeType: "image/png",
		data: new Uint8Array([1, 2, 3]),
		name: "image-1",
		meta: { keep: true }
	};
	const replaced = replaceImageInputPartData(part, Buffer.from([9, 8, 7]));
	const replacedRecord = replaced as unknown as Record<string, unknown>;

	assert.equal(replacedRecord.mimeType, "image/png");
	assert.equal(replacedRecord.name, "image-1");
	assert.deepEqual(replacedRecord.meta, { keep: true });
	assert.deepEqual(Array.from(replacedRecord.data as Uint8Array), [9, 8, 7]);
});

test("isImageInputPart rejects non-image and accepts image payload", () => {
	assert.equal(isImageInputPart({ mimeType: "text/plain", data: new Uint8Array([1]) }), false);
	assert.equal(isImageInputPart({ mimeType: "image/jpeg", data: new Uint8Array([1]) }), true);
});
