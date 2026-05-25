import test from "node:test";
import assert from "node:assert/strict";

/**
 * Keep in sync with `scripts/build/check-vsix-contents.mjs` deny patterns (release vs test VSIX).
 */
const denyRelease = [
	/\bout\/test\//u,
	/\bout\/e2e\//u,
	/\/extension\/src\//u,
	/\/extension\/docs\//u,
	/VISION_EXECUTION_ANALYSIS/u
] as const;

const denyTest = [
	/\/extension\/src\//u,
	/\/extension\/docs\//u,
	/VISION_EXECUTION_ANALYSIS/u
] as const;

function assertDenyAbsent(listing: string, patterns: readonly RegExp[], label: string): void {
	for (const pattern of patterns) {
		const hit = listing.split(/\r?\n/).find((line) => pattern.test(line));
		if (hit) {
			assert.fail(`${label}: forbidden path matched ${String(pattern)}: ${hit.trim()}`);
		}
	}
}

test("VSIX listing policy: release denies automation and test out dirs", () => {
	const listing = [
		"extension/out/extension.js",
		"extension/out/test/runner.js",
		"extension/out/e2e/driver/hostUiSmoke.js"
	].join("\n");
	assert.throws(() => assertDenyAbsent(listing, denyRelease, "release VSIX"));
	const okListing = ["extension/out/extension.js", "extension/out/chat/foo.js"].join("\n");
	assertDenyAbsent(okListing, denyRelease, "release VSIX");
});

test("VSIX listing policy: test VSIX allows out/e2e/driver but release denies all e2e", () => {
	const testListing = [
		"extension/out/e2e/driver/hostUiSmoke.js",
		"extension/out/extension.js"
	].join("\n");
	assertDenyAbsent(testListing, denyTest, "test VSIX");
	const releaseListing = [
		"extension/out/e2e/driver/hostUiSmoke.js",
		"extension/out/extension.js"
	].join("\n");
	assert.throws(() => assertDenyAbsent(releaseListing, denyRelease, "release VSIX"));
	const releaseHostUi = ["extension/out/e2e/hostUi/env.js", "extension/out/extension.js"].join("\n");
	assert.throws(() => assertDenyAbsent(releaseHostUi, denyRelease, "release VSIX"));
	const releaseActivation = ["extension/out/e2e/hostUi/extensionSmokeActivation.js"].join("\n");
	assert.throws(() => assertDenyAbsent(releaseActivation, denyRelease, "release VSIX"));
});

test("VSIX listing policy: both flavors forbid /extension/src/ and analysis marker filename", () => {
	const badSrc = "extension/extension/src/foo.js";
	assert.throws(() => assertDenyAbsent(badSrc, denyTest, "test VSIX"));
	assert.throws(() => assertDenyAbsent(badSrc, denyRelease, "release VSIX"));
	const badAnalysis = "extension/docs/VISION_EXECUTION_ANALYSIS.md";
	assert.throws(() => assertDenyAbsent(badAnalysis, denyTest, "test VSIX"));
});
