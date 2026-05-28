import test from "node:test";
import assert from "node:assert/strict";
import { acceptStructuredVisionTextEvidence } from "../visionProxyStructuredPlan";

test("VTE-01 acceptStructuredVisionTextEvidence rejects when disabled", () => {
	assert.deepEqual(
		acceptStructuredVisionTextEvidence("some long enough text".repeat(10), { allowTextEvidence: false }),
		{ accepted: false, reason: "text-evidence-not-allowed" }
	);
});

test("VTE-02 acceptStructuredVisionTextEvidence rejects empty/short text", () => {
	assert.deepEqual(acceptStructuredVisionTextEvidence("", { allowTextEvidence: true }), { accepted: false, reason: "empty" });
	assert.deepEqual(
		acceptStructuredVisionTextEvidence("too short", { allowTextEvidence: true }),
		{ accepted: false, reason: "too-short" }
	);
});

test("VTE-03 acceptStructuredVisionTextEvidence accepts long text evidence", () => {
	const raw = "这是一个按钮截图，包含蓝色背景和白色文字，主要元素位于画面中心。".repeat(6);
	const accepted = acceptStructuredVisionTextEvidence(raw, { allowTextEvidence: true });
	assert.equal(accepted.accepted, true);
	if (accepted.accepted) {
		assert.equal(accepted.description.includes("按钮截图"), true);
	}
});

