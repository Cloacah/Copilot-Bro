import test from "node:test";
import assert from "node:assert/strict";
import { shouldUseStructuredVisionFormatFallback } from "../visionProxyStructuredPlan";

test("format-fallback requires explicit last-resort allowance", () => {
	assert.equal(
		shouldUseStructuredVisionFormatFallback("invalid format: not json", false),
		false
	);
	assert.equal(
		shouldUseStructuredVisionFormatFallback("at least one visual element is required", false),
		false
	);
});

test("format-fallback allowed only when last-resort flag is set", () => {
	assert.equal(
		shouldUseStructuredVisionFormatFallback("invalid format: not json", true),
		true
	);
	assert.equal(
		shouldUseStructuredVisionFormatFallback("at least one visual element is required", true),
		true
	);
	assert.equal(shouldUseStructuredVisionFormatFallback(undefined, true), false);
});
