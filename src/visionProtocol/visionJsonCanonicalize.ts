/**
 * Post-parse canonicalization for vision-proxy JSON from models that split tokens
 * across newlines (keys like "element Id", enums like "i mage", contract strings).
 */

const VISION_JSON_KEY_ALIASES: Readonly<Record<string, string>> = {
	contract: "contract",
	scenesummary: "sceneSummary",
	observations: "observations",
	recognizedtext: "recognizedText",
	layout: "layout",
	elements: "elements",
	elementid: "elementId",
	label: "label",
	mode: "mode",
	confidence: "confidence",
	rationale: "rationale",
	regions: "regions",
	bbox: "bbox",
	x: "x",
	y: "y",
	w: "w",
	h: "h",
	imageparams: "imageParams",
	svgparams: "svgParams",
	crop: "crop",
	resize: "resize",
	width: "width",
	height: "height",
	threshold: "threshold",
	priority: "priority",
	strokewidth: "strokeWidth",
	fillcolor: "fillColor",
	pathhint: "pathHint",
	transformhints: "transformHints",
	affineanchorsorgrid: "affineAnchorsOrGrid",
	maxdisplacement: "maxDisplacement",
	clamptobounds: "clampToBounds"
};

function compactKeyToken(key: string): string {
	return key.replace(/[\s_\-\n\r\t]+/gu, "").toLowerCase();
}

export function canonicalizeVisionJsonKey(key: string): string {
	const trimmed = key.trim();
	if (!trimmed) {
		return trimmed;
	}
	if (/^[a-z][a-zA-Z0-9]*$/u.test(trimmed)) {
		return trimmed;
	}
	return VISION_JSON_KEY_ALIASES[compactKeyToken(trimmed)] ?? trimmed;
}

export function canonicalizeVisionProxyParsedJson(value: unknown): { value: unknown; remapped: boolean } {
	if (value === null || value === undefined) {
		return { value, remapped: false };
	}
	if (Array.isArray(value)) {
		let remapped = false;
		const items = value.map((item) => {
			const next = canonicalizeVisionProxyParsedJson(item);
			remapped ||= next.remapped;
			return next.value;
		});
		return { value: items, remapped };
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		let remapped = false;
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(record)) {
			const canonicalKey = canonicalizeVisionJsonKey(key);
			if (canonicalKey !== key) {
				remapped = true;
			}
			const next = canonicalizeVisionProxyParsedJson(val);
			remapped ||= next.remapped;
			out[canonicalKey] = next.value;
		}
		return { value: out, remapped };
	}
	return { value, remapped: false };
}
