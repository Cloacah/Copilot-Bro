import test from "node:test";
import assert from "node:assert/strict";
import { clampProxyBBoxToImage } from "../visionProxyBBox";

test("clampProxyBBoxToImage fits oversized LLM bbox into image bounds", () => {
	const clamped = clampProxyBBoxToImage({ x: 0, y: 0, w: 1920, h: 45 }, 1229, 768);
	assert.equal(clamped.x, 0);
	assert.equal(clamped.y, 0);
	assert.equal(clamped.w, 1229);
	assert.equal(clamped.h, 45);
});

test("clampProxyBBoxToImage preserves valid in-bounds bbox", () => {
	const bbox = { x: 10, y: 20, w: 100, h: 50 };
	assert.deepEqual(clampProxyBBoxToImage(bbox, 800, 600), bbox);
});
