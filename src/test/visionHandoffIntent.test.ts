import test from "node:test";
import assert from "node:assert/strict";
import { buildVisionPromptContract } from "../toolCooperation/visionPromptContract";
import {
	resolveVisionHandoffIntent,
	resolveVisionHandoffIntentForTurn
} from "../visionProtocol/visionHandoffIntent";

test("resolveVisionHandoffIntent detects describe-only markers", () => {
	assert.equal(resolveVisionHandoffIntent("[host-ui-p6] path-only"), "describe-only");
	assert.equal(resolveVisionHandoffIntent("describe-only summary"), "describe-only");
});

test("resolveVisionHandoffIntent detects restore-artifact markers", () => {
	assert.equal(resolveVisionHandoffIntent("[host-ui-p7-restore] Perfect vector restoration"), "restore-artifact");
	assert.equal(resolveVisionHandoffIntent("高保真还原这个按钮"), "restore-artifact");
	assert.equal(
		resolveVisionHandoffIntent("精准还原这张图片中的内容到一个web界面中"),
		"restore-artifact"
	);
});

test("resolveVisionHandoffIntent prefers describe-only when both markers appear", () => {
	assert.equal(
		resolveVisionHandoffIntent("describe-only: no svg restoration for this turn"),
		"describe-only"
	);
});

test("resolveVisionHandoffIntentForTurn prefers user describe over high-fidelity restoration prompt", () => {
	const highFidelity = buildVisionPromptContract("v1");
	assert.equal(
		resolveVisionHandoffIntentForTurn(
			"[host-ui-p3-proxy] Global vision proxy: describe the attached small PNG in ≤12 words.",
			highFidelity
		),
		"describe-only"
	);
	assert.equal(
		resolveVisionHandoffIntentForTurn(
			"[host-ui-p7-restore] Perfect vector restoration of this real UI button image.",
			highFidelity
		),
		"restore-artifact"
	);
});
