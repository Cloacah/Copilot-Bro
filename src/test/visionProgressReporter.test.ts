import test from "node:test";
import assert from "node:assert/strict";
import {
	buildVisionProgressFlushMeta,
	createVisionProgressReporter,
	getLastHostUiSmokeVisionProgressFlush,
	resetHostUiSmokeVisionProgressCapture
} from "../toolCooperation/visionProgressReporter";
import { isVisionProgressDetailsText, renderVisionThinkingDetails } from "../toolCooperation/outputSemantics";

test("createVisionProgressReporter batches multiple [Vision] lines into one flush", () => {
	const reporter = createVisionProgressReporter();
	reporter.append("[Vision] start · proxy · req=abc");
	reporter.append("[Vision] input · source=tool-screenshot · tool=screenshot_page");
	assert.equal(reporter.chunkCount, 2);

	const payloads: string[] = [];
	const meta = reporter.flush(
		{ report() {} },
		true,
		(displayText) => {
			payloads.push(displayText);
			return buildVisionProgressFlushMeta(displayText, true);
		}
	);
	assert.ok(meta);
	assert.equal(meta.chunkCount, 2);
	assert.equal(payloads.length, 1);
	assert.match(payloads[0]!, /\[Vision\] start/u);
	assert.match(payloads[0]!, /screenshot_page/u);
});

test("renderVisionThinkingDetails wraps plain [Vision] lines in collapsible details", () => {
	const html = renderVisionThinkingDetails("[Vision] start · proxy · req=abc");
	assert.ok(isVisionProgressDetailsText(html));
	assert.match(html, /data-extended-models-vision="true"/u);
	assert.match(html, /\[Vision\] start/u);
});

test("renderVisionThinkingDetails preserves structured snapshot marker", () => {
	const block = renderVisionThinkingDetails(
		"[Vision] structured evidence\n<details data-extended-models-vision-structured=\"true\"><summary>x</summary></details>"
	);
	assert.match(block, /data-extended-models-vision-structured/u);
});

test("host-ui-smoke capture records flush metadata when COPILOT_BRO_UI_SMOKE=1", () => {
	const prior = process.env.COPILOT_BRO_UI_SMOKE;
	process.env.COPILOT_BRO_UI_SMOKE = "1";
	resetHostUiSmokeVisionProgressCapture();
	try {
		const reporter = createVisionProgressReporter();
		reporter.append("[Vision] input · source=tool-screenshot");
		reporter.flush({ report() {} }, true, (displayText) => buildVisionProgressFlushMeta(displayText, false));
		const captured = getLastHostUiSmokeVisionProgressFlush();
		assert.ok(captured);
		assert.equal(captured.chunkCount, 1);
		assert.equal(captured.containsVisionPrefix, true);
	} finally {
		if (prior === undefined) {
			delete process.env.COPILOT_BRO_UI_SMOKE;
		} else {
			process.env.COPILOT_BRO_UI_SMOKE = prior;
		}
		resetHostUiSmokeVisionProgressCapture();
	}
});
