import test from "node:test";
import assert from "node:assert/strict";
import type { Logger } from "../logger";
import { applyOptionalVisionThreshold } from "../toolCooperation/visionThresholdFallback";
import { createImagePathHydrationPolicy, shouldHydrateTextPathsForMessage } from "../toolCooperation/visionPathHydrationPolicy";

test("vision proxy keeps model-discovered image paths out of the proxy route when an explicit image is already attached", () => {
	const policy = createImagePathHydrationPolicy([
		{
			content: [{ mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }]
		} as { content: Array<{ mimeType: string; data: Uint8Array }> },
		{
			content: [{ value: "artifacts/example.png" }]
		} as { content: Array<{ value: string }> }
	]);

	assert.equal(policy.allowNonUserTextPaths, false);
	assert.equal(policy.scope, "last-user-only");
	assert.equal(shouldHydrateTextPathsForMessage({ role: "user" }, policy), true);
	assert.equal(shouldHydrateTextPathsForMessage({ role: "assistant" }, policy), false);
	assert.equal(shouldHydrateTextPathsForMessage({ role: "tool" }, policy), false);
});

test("vision proxy still allows non-user path hydration when the request has no explicit image input", () => {
	const policy = createImagePathHydrationPolicy([
		{
			content: [{ value: "artifacts/example.png" }]
		} as { content: Array<{ value: string }> }
	]);

	assert.equal(policy.allowNonUserTextPaths, true);
	assert.equal(policy.scope, "last-user-only");
	assert.equal(shouldHydrateTextPathsForMessage({ role: "assistant" }, policy), true);
	assert.equal(shouldHydrateTextPathsForMessage({ role: "tool" }, policy), true);
});

test("applyOptionalVisionThreshold keeps proxy execution alive when image-js is unavailable", async () => {
	const original = Buffer.from([1, 2, 3, 4]);
	const warnings: string[] = [];
	const logCalls: Array<{ message: string; data: unknown }> = [];

	const output = await applyOptionalVisionThreshold(
		{
			async threshold(): Promise<Buffer> {
				throw new Error("[image-js] threshold failed: image-js is unavailable: Cannot find module 'image-js'");
			}
		},
		original,
		127,
		warnings,
		{
			warn(message: string, data?: unknown): void {
				logCalls.push({ message, data });
			}
		} as Pick<Logger, "warn">
	);

	assert.deepEqual(output, original);
	assert.deepEqual(warnings, ["image-processing:threshold_skipped_unavailable"]);
	assert.equal(logCalls.length, 1);
	assert.equal(logCalls[0]?.message, "vision.proxy.image.threshold.skipped");
});

test("applyOptionalVisionThreshold still throws real threshold processing failures", async () => {
	await assert.rejects(
		() => applyOptionalVisionThreshold(
			{
				async threshold(): Promise<Buffer> {
					throw new Error("[image-js] threshold failed: invalid image buffer");
				}
			},
			Buffer.from([1, 2, 3]),
			127,
			[],
			{
				warn(): void {
					// noop
				}
			} as Pick<Logger, "warn">
		),
		/invalid image buffer/
	);
});