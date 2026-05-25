import test from "node:test";
import assert from "node:assert/strict";
import { detectImageMimeType, resolveImageMimeType } from "../toolCooperation/imageMime";

test("detectImageMimeType prefers png bytes over a misleading jpg extension", () => {
	const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
	assert.equal(detectImageMimeType(pngBytes), "image/png");
});

test("detectImageMimeType recognizes jpeg gif webp bmp and svg signatures", () => {
	assert.equal(detectImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xdb])), "image/jpeg");
	assert.equal(detectImageMimeType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), "image/gif");
	assert.equal(detectImageMimeType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
	assert.equal(detectImageMimeType(new Uint8Array([0x42, 0x4d, 0x00, 0x00])), "image/bmp");
	assert.equal(detectImageMimeType(new TextEncoder().encode("<?xml version=\"1.0\"?><svg viewBox=\"0 0 1 1\"></svg>")), "image/svg+xml");
	assert.equal(detectImageMimeType(new Uint8Array([0x00, 0x01, 0x02, 0x03])), undefined);
});

test("resolveImageMimeType corrects mismatched extension mime and falls back when bytes are unknown", () => {
	const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
	assert.deepEqual(resolveImageMimeType(pngBytes, "image/jpeg"), {
		mimeType: "image/png",
		detectedMimeType: "image/png",
		corrected: true
	});
	assert.deepEqual(resolveImageMimeType(new Uint8Array([0x00, 0x01, 0x02]), "image/jpeg"), {
		mimeType: "image/jpeg",
		detectedMimeType: undefined,
		corrected: false
	});
});