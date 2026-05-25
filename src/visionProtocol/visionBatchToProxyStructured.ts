import {
	STRUCTURED_PROXY_CONTRACT_VERSION,
	normalizeStructuredProxyOutput,
	type ProxyStructuredOutput
} from "../visionProxyStructuredPlan";
import type { VisionBatchResult } from "./types";

/** Maps native {@link VisionBatchResult} geometry objects to proxy contract v3 `elements[]`. */
export function convertVisionBatchToProxyStructuredOutput(batch: VisionBatchResult): ProxyStructuredOutput {
	const elements: ProxyStructuredOutput["elements"] = [];
	for (const result of batch.results) {
		for (const object of result.objects) {
			const bbox = object.geometry.bbox;
			const confidence = clamp01(object.geometry.confidence ?? 0.85);
			const rationale = (object.geometry.rationale || object.rationale || object.label).trim();
			elements.push({
				elementId: object.id || `native-${elements.length + 1}`,
				label: object.label,
				mode: "none",
				confidence,
				rationale,
				observations: [],
				recognizedText: [],
				layout: [],
				regions: [
					{
						label: object.label,
						bbox: {
							x: bbox.x,
							y: bbox.y,
							w: bbox.w,
							h: bbox.h
						},
						confidence,
						priority: 1,
						rationale
					}
				]
			});
		}
	}
	const draft: ProxyStructuredOutput = {
		contract: STRUCTURED_PROXY_CONTRACT_VERSION,
		sceneSummary: `Native vision batch ${batch.batchId} (${elements.length} element(s))`,
		observations: [],
		recognizedText: [],
		layout: [],
		elements
	};
	const normalized = normalizeStructuredProxyOutput(draft);
	return normalized.ok ? normalized.value : draft;
}

export function buildProxyStructuredSnapshotJson(structured: ProxyStructuredOutput): string {
	return JSON.stringify(structured);
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0.85;
	}
	return Math.max(0, Math.min(1, value));
}
