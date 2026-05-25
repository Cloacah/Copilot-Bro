import test from "node:test";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../config/highFidelityRestoreImagePipelineSuspended";
import assert from "node:assert/strict";
import {
	isBboxPlaceholderSvg,
	resolveProductionSvgOutput
} from "../toolCooperation/visionSvgFidelity";

const PLACEHOLDER = [
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">',
	'<rect x="0" y="0" width="10" height="10" fill="#FFFFFF" stroke="#111"/>',
	"<desc>target</desc>",
	"</svg>"
].join("");

const VECTOR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0H4V4H0Z"/></svg>';

test("isBboxPlaceholderSvg detects single-rect placeholder SVG", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	assert.equal(isBboxPlaceholderSvg(PLACEHOLDER), true);
	assert.equal(isBboxPlaceholderSvg(VECTOR), false);
	assert.equal(isBboxPlaceholderSvg(undefined), false);
});

test("resolveProductionSvgOutput rejects placeholder unless explicitly allowed", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const blocked = resolveProductionSvgOutput(PLACEHOLDER, PLACEHOLDER, false);
	assert.equal(blocked.svg, undefined);
	assert.equal(blocked.rejectedPlaceholder, true);
	const allowed = resolveProductionSvgOutput(undefined, PLACEHOLDER, true);
	assert.equal(allowed.usedPlaceholder, true);
	assert.equal(allowed.svg, PLACEHOLDER);
	const real = resolveProductionSvgOutput(VECTOR, PLACEHOLDER, false);
	assert.equal(real.svg, VECTOR);
});
