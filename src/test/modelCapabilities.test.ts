import test from "node:test";
import assert from "node:assert/strict";
import { getDeclaredImageInputCapability } from "../modelCapabilities";


test("getDeclaredImageInputCapability reflects native or proxy-backed vision entry", () => {
	assert.equal(getDeclaredImageInputCapability({ vision: true }), true);
	assert.equal(getDeclaredImageInputCapability({ vision: false } as { vision: boolean; visionProxyModelId: string }), false);
	assert.equal(getDeclaredImageInputCapability(
		{ vision: false, visionProxyModelId: "gpt-4.1" } as { vision: boolean; visionProxyModelId: string },
		{ proxyAvailable: true }
	), true);
});
