import { extractJsonObjectFromVisionText } from "./visionJsonExtract";
import { normalizeStructuredProxyOutput } from "../visionProxyStructuredPlan";

export interface VisionJsonRepairProbeSample {
	readonly id: string;
	readonly raw: string;
}

/** Minimal v3 element used in repair probe fixtures. */
const PROBE_ELEMENT_JSON = `{
  "elementId": "probe-btn",
  "label": "Probe button",
  "mode": "none",
  "confidence": 0.9,
  "rationale": "solid color probe tile",
  "observations": ["flat"],
  "recognizedText": [],
  "layout": [],
  "regions": [{ "label": "tile", "bbox": { "x": 0, "y": 0, "w": 12, "h": 12 }, "confidence": 0.9, "priority": 1, "rationale": "full frame" }]
}`;

function buildProbeContractJson(options?: { trailingComma?: boolean; unclosed?: boolean }): string {
	const trailingComma = options?.trailingComma ? "," : "";
	const close = options?.unclosed ? "" : "}";
	return `{
  "contract": "vision-proxy-contract-v3",
  "sceneSummary": "Host UI JSON repair probe tile",
  "observations": ["probe"],
  "recognizedText": [],
  "layout": ["single tile"],
  "elements": [${PROBE_ELEMENT_JSON}]${trailingComma}
${close}`;
}

export const VISION_JSON_REPAIR_PROBE_SAMPLES: readonly VisionJsonRepairProbeSample[] = [
	{
		id: "trailing-comma",
		raw: buildProbeContractJson({ trailingComma: true })
	},
	{
		id: "prose-wrapped",
		raw: `Analysis preamble — structured payload follows.\n${buildProbeContractJson()}\nEnd of vision notes.`
	},
	{
		id: "unclosed-brace",
		raw: buildProbeContractJson({ unclosed: true })
	},
	{
		id: "fenced-json",
		raw: "```json\n" + buildProbeContractJson() + "\n```"
	},
	{
		id: "glm-split-keys-decimals",
		raw: [
			"{",
			'"contract": "vision-proxy-contract-v3",',
			'"scene Summary": "probe tile",',
			'"elements": [{',
			'"element Id": "probe-btn",',
			'"label": "Probe",',
			'"mode": "none",',
			'"confidence": 0 . 9,',
			'"rationale": "solid color probe tile",',
			'"observations": [],',
			'"recognized Text": [],',
			'"layout": [],',
			'"regions": [{ "label": "tile", "bbox": { "x": 0, "y": 0, "w": 12, "h": 12 },',
			'"confidence": 0 . 9, "priority": 1, "rationale": "full frame" }]',
			"}]",
			"}"
		].join("\n")
	}
];

export interface VisionJsonRepairProbeSampleResult {
	readonly id: string;
	readonly extracted: boolean;
	readonly repaired: boolean;
	readonly normalizedOk: boolean;
	readonly error?: string;
}

export function runVisionJsonRepairProbe(): {
	readonly ok: boolean;
	readonly results: readonly VisionJsonRepairProbeSampleResult[];
} {
	const results: VisionJsonRepairProbeSampleResult[] = [];
	for (const sample of VISION_JSON_REPAIR_PROBE_SAMPLES) {
		const extracted = extractJsonObjectFromVisionText(sample.raw);
		if (!extracted) {
			results.push({
				id: sample.id,
				extracted: false,
				repaired: false,
				normalizedOk: false,
				error: "extract failed"
			});
			continue;
		}
		const normalized = normalizeStructuredProxyOutput(extracted.value);
		results.push({
			id: sample.id,
			extracted: true,
			repaired: extracted.repaired,
			normalizedOk: normalized.ok,
			error: normalized.ok ? undefined : normalized.error
		});
	}
	return {
		ok: results.every((result) => result.extracted && result.normalizedOk),
		results
	};
}
