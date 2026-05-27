import test from "node:test";
import assert from "node:assert/strict";
import {
	createVisionChatSurface,
	emitVisionChatProgress
} from "../visionProtocol/visionChatSurface";
import {
	formatVisionProgressForChatCollapsible,
	formatVisionStructuredThinkingBlock,
	isVisionProgressDetailsText,
	renderVisionCollapsibleBlock
} from "../toolCooperation/outputSemantics";

test("VUI-01 renderVisionCollapsibleBlock wraps content without bare headline outside details", () => {
	const html = renderVisionCollapsibleBlock("route-status", "识图 · start · proxy", "req=abc · proxy");
	assert.ok(isVisionProgressDetailsText(html));
	const outsideDetails = html.split("</summary>")[0] ?? "";
	assert.ok(!/\[Vision\]\s+start/u.test(outsideDetails));
});

test("VUI-02 createVisionChatSurface batches append into one report", () => {
	const surface = createVisionChatSurface();
	surface.appendRawLine("[Vision] start · proxy · req=abc");
	surface.appendRawLine("[Vision] input · source=user-attachment");
	const reports: string[] = [];
	const meta = surface.flush(
		{ report(part: unknown) { reports.push(String((part as { value?: string }).value ?? part)); } },
		true
	);
	assert.ok(meta);
	assert.equal(reports.length, 1);
	assert.ok(isVisionProgressDetailsText(reports[0]!));
});

test("VUI-03 emitVisionChatProgress respects visible=false", () => {
	let count = 0;
	emitVisionChatProgress(
		{ report() { count += 1; } },
		false,
		renderVisionCollapsibleBlock("debug", "识图 · 调试", "detail")
	);
	assert.equal(count, 0);
});

test("VUI-04 structured snapshot truncates and escapes JSON in details", () => {
	const payload = JSON.stringify({ contract: "v3", elements: [{ id: "x" }] });
	const big = payload.repeat(2000);
	assert.ok(big.length > 6000);
	const block = formatVisionStructuredThinkingBlock(big, {
		contract: "vision-proxy-contract-v3",
		elementCount: 2,
		route: "proxy"
	});
	assert.ok(block.includes("data-extended-models-vision-structured"));
	assert.ok(!block.split("</summary>")[0]!.includes("[Vision] structured"));
	assert.ok(block.length < big.length);
});

test("formatVisionProgressForChatCollapsible folds plain vision lines", () => {
	const html = formatVisionProgressForChatCollapsible("[Vision] start · proxy · req=abc");
	assert.ok(isVisionProgressDetailsText(html));
});
