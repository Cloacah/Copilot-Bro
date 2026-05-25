import test from "node:test";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../config/highFidelityRestoreImagePipelineSuspended";
import assert from "node:assert/strict";
import { buildVisionRestoreWebPageHtml } from "../toolCooperation/visionRestorePageComposer";
import { countClickableRestoreLayers } from "../toolCooperation/visionRestoreWebPageHtml";

test("buildVisionRestoreWebPageHtml emits one clickable button per layer", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const html = buildVisionRestoreWebPageHtml(
		{
			width: 100,
			height: 50,
			layers: [
				{
					elementId: "a",
					bbox: { x: 0, y: 0, w: 50, h: 50 },
					mode: "image"
				},
				{
					elementId: "b",
					bbox: { x: 50, y: 0, w: 50, h: 50 },
					mode: "svg",
					svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\" fill=\"red\"/></svg>"
				}
			]
		},
		new Map([["a", "data:image/png;base64,aa"], ["b", "data:image/png;base64,bb"]])
	);
	const ids = countClickableRestoreLayers(html);
	assert.deepEqual(ids.sort(), ["a", "b"]);
	assert.match(html, /button[^>]*data-element-id="a"/u);
	assert.match(html, /data-restore-mode="image"/u);
	assert.match(html, /data-restore-mode="svg"/u);
});
