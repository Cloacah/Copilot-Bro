import test from "node:test";
import assert from "node:assert/strict";
import { formatVisionStructuredThinkingBlock } from "../toolCooperation/outputSemantics";

test("formatVisionStructuredThinkingBlock avoids markdown code fences", () => {
	const block = formatVisionStructuredThinkingBlock('{"a":1,"nested":"```oops"}', {
		contract: "vision-proxy-contract-v3",
		elementCount: 1,
		toolName: "screenshot_page"
	});
	assert.doesNotMatch(block, /```/);
	assert.match(block, /data-extended-models-vision-structured/);
	assert.match(block, /<pre>/);
	assert.match(block, /&quot;a&quot;/);
});

test("formatVisionStructuredThinkingBlock does not emit raw angle-bracket tool tags", () => {
	const block = formatVisionStructuredThinkingBlock('</｜DSML｜content>', {
		contract: "vision-proxy-contract-v3",
		elementCount: 0
	});
	assert.doesNotMatch(block, /<\/｜DSML｜content>/);
	assert.match(block, /&lt;\/｜DSML｜content&gt;/);
});
