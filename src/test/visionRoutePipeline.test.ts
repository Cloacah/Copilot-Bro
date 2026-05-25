import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { VISION_ROUTE_PIPELINE_STAGES } from "../visionProtocol/visionRoutePipeline";

test("vision route pipeline stages match docs/vision-route-order.md headings", () => {
	const docPath = path.join(process.cwd(), "docs", "vision-route-order.md");
	const doc = readFileSync(docPath, "utf8");
	for (const stage of VISION_ROUTE_PIPELINE_STAGES) {
		assert.match(doc, new RegExp(stage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"), `missing stage ${stage} in vision-route-order.md`);
	}
});
