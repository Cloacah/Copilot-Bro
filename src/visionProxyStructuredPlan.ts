export const STRUCTURED_PROXY_CONTRACT_VERSION = "vision-proxy-contract-v3";

export type ProxyPlanMode = "image" | "svg" | "none";

export interface ProxyBBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ProxyRegion {
	label: string;
	bbox: ProxyBBox;
	confidence: number;
	priority: number;
	rationale: string;
}

export interface ProxyImageParams {
	crop?: ProxyBBox;
	resize?: { width: number; height: number };
	threshold?: number;
}

export interface ProxySvgParams {
	mode: "bbox-overlay" | "path-guided";
	strokeWidth?: number;
	fillColor?: string;
	pathHint?: string;
}

export interface ProxyVisualElement {
	elementId: string;
	label: string;
	mode: ProxyPlanMode;
	confidence: number;
	rationale: string;
	observations: string[];
	recognizedText: string[];
	layout: string[];
	regions: ProxyRegion[];
	imageParams?: ProxyImageParams;
	svgParams?: ProxySvgParams;
}

export interface ProxyStructuredOutput {
	contract: string;
	sceneSummary: string;
	observations: string[];
	recognizedText: string[];
	layout: string[];
	elements: ProxyVisualElement[];
}

export function normalizeStructuredProxyOutput(value: unknown): { ok: true; value: ProxyStructuredOutput } | { ok: false; error: string } {
	if (!value || typeof value !== "object") {
		return { ok: false, error: "payload must be an object" };
	}
	const record = value as Record<string, unknown>;
	const contract = typeof record.contract === "string" ? record.contract.trim() : "";
	if (
		contract !== STRUCTURED_PROXY_CONTRACT_VERSION
		&& contract !== "vision-proxy-contract-v2"
		&& contract !== ""
	) {
		return { ok: false, error: `contract must be ${STRUCTURED_PROXY_CONTRACT_VERSION}` };
	}
	const sceneSummary = truncateProxyText(asText(record.sceneSummary), 1200);
	const observations = normalizeTextList(record.observations, 24, 220);
	const recognizedText = normalizeTextList(record.recognizedText, 24, 160);
	const layout = normalizeTextList(record.layout, 16, 220);
	const elements = normalizeElements(record);
	if (elements.length === 0) {
		return { ok: false, error: "at least one visual element is required" };
	}
	if (!sceneSummary && elements.every((element) => !element.rationale)) {
		return { ok: false, error: "sceneSummary or element rationale is required" };
	}
	return {
		ok: true,
		value: {
			contract: STRUCTURED_PROXY_CONTRACT_VERSION,
			sceneSummary: sceneSummary || elements[0]!.rationale,
			observations,
			recognizedText,
			layout,
			elements
		}
	};
}

function normalizeElements(record: Record<string, unknown>): ProxyVisualElement[] {
	if (Array.isArray(record.elements)) {
		const parsed: ProxyVisualElement[] = [];
		for (const [index, item] of record.elements.entries()) {
			const element = normalizeElement(item, index);
			if (element) {
				parsed.push(element);
			}
		}
		return parsed;
	}
	const legacy = normalizeLegacySingleElement(record);
	return legacy ? [legacy] : [];
}

function normalizeLegacySingleElement(record: Record<string, unknown>): ProxyVisualElement | undefined {
	const mode = normalizeMode(record.mode);
	if (!mode) {
		return undefined;
	}
	const regions = normalizeRegions(record.regions);
	if (mode !== "none" && regions.length === 0) {
		return undefined;
	}
	const rationale = truncateProxyText(asText(record.rationale), 400);
	if (!rationale) {
		return undefined;
	}
	return {
		elementId: "element-1",
		label: regions[0]?.label ?? "primary",
		mode,
		confidence: clamp01(asNumber(record.confidence, 0)),
		rationale,
		observations: normalizeTextList(record.observations, 12, 220),
		recognizedText: normalizeTextList(record.recognizedText, 12, 160),
		layout: normalizeTextList(record.layout, 8, 220),
		regions,
		imageParams: normalizeImageParams(record.imageParams),
		svgParams: normalizeSvgParams(record.svgParams)
	};
}

function normalizeElement(value: unknown, index: number): ProxyVisualElement | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const mode = normalizeMode(record.mode);
	if (!mode) {
		return undefined;
	}
	const rationale = truncateProxyText(asText(record.rationale), 400);
	if (!rationale) {
		return undefined;
	}
	const regions = normalizeRegions(record.regions);
	if (mode !== "none" && regions.length === 0) {
		return undefined;
	}
	const elementId = truncateProxyText(asText(record.elementId) || `element-${index + 1}`, 64);
	const label = truncateProxyText(asText(record.label) || regions[0]?.label || elementId, 120);
	const imageParams = normalizeImageParams(record.imageParams);
	const svgParams = normalizeSvgParams(record.svgParams);
	if (mode === "image" && !imageParams?.crop && regions.length === 0) {
		return undefined;
	}
	if (mode === "svg" && !svgParams) {
		return undefined;
	}
	return {
		elementId,
		label,
		mode,
		confidence: clamp01(asNumber(record.confidence, 0)),
		rationale,
		observations: normalizeTextList(record.observations, 12, 220),
		recognizedText: normalizeTextList(record.recognizedText, 12, 160),
		layout: normalizeTextList(record.layout, 8, 220),
		regions,
		imageParams,
		svgParams
	};
}

function normalizeMode(value: unknown): ProxyPlanMode | undefined {
	if (value === "image" || value === "svg" || value === "none") {
		return value;
	}
	return undefined;
}

function normalizeRegions(value: unknown): ProxyRegion[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const regions: ProxyRegion[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const record = item as Record<string, unknown>;
		const label = truncateProxyText(asText(record.label), 120);
		const bbox = normalizeBBox(record.bbox);
		if (!label || !bbox) {
			continue;
		}
		regions.push({
			label,
			bbox,
			confidence: clamp01(asNumber(record.confidence, 0)),
			priority: Math.max(1, Math.floor(asNumber(record.priority, 1))),
			rationale: truncateProxyText(asText(record.rationale) || "proxy supplied region", 220)
		});
	}
	return regions.sort((a, b) => a.priority - b.priority);
}

function normalizeBBox(value: unknown): ProxyBBox | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const x = Math.max(0, Math.round(asNumber(record.x, -1)));
	const y = Math.max(0, Math.round(asNumber(record.y, -1)));
	const w = Math.max(1, Math.round(asNumber(record.w, 0)));
	const h = Math.max(1, Math.round(asNumber(record.h, 0)));
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return undefined;
	}
	return { x, y, w, h };
}

function normalizeImageParams(value: unknown): ProxyImageParams | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const crop = normalizeBBox(record.crop);
	const resizeRaw = record.resize;
	let resize: { width: number; height: number } | undefined;
	if (resizeRaw && typeof resizeRaw === "object") {
		const resizeRecord = resizeRaw as Record<string, unknown>;
		const width = Math.max(1, Math.round(asNumber(resizeRecord.width, 0)));
		const height = Math.max(1, Math.round(asNumber(resizeRecord.height, 0)));
		if (width > 0 && height > 0) {
			resize = { width, height };
		}
	}
	const thresholdRaw = record.threshold;
	const threshold = thresholdRaw === undefined ? undefined : clamp01(asNumber(thresholdRaw, 0.5)) * 255;
	if (!crop && !resize && threshold === undefined) {
		return undefined;
	}
	return { crop, resize, threshold };
}

function normalizeSvgParams(value: unknown): ProxySvgParams | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const mode = record.mode === "bbox-overlay" || record.mode === "path-guided" ? record.mode : undefined;
	if (!mode) {
		return undefined;
	}
	return {
		mode,
		strokeWidth: asNumber(record.strokeWidth, 1),
		fillColor: asHexColor(record.fillColor),
		pathHint: truncateProxyText(asText(record.pathHint), 400)
	};
}

function normalizeTextList(value: unknown, maxItems: number, maxLen: number): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((item) => truncateProxyText(asText(item), maxLen))
		.filter(Boolean)
		.slice(0, maxItems);
}

function asText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}

function truncateProxyText(value: string, maxLen: number): string {
	if (value.length <= maxLen) {
		return value;
	}
	return `${value.slice(0, maxLen - 1)}…`;
}

function asHexColor(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim();
	return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toUpperCase() : undefined;
}

/**
 * Valid v3 plan when the vision model returns YAML without elements (e.g. solid-color smoke PNG).
 * Keeps describe-only / native high-fidelity paths alive and allows evidence persistence.
 */
export function buildMinimalStructuredVisionFallback(
	sceneSummary = "Uniform or low-detail image with no discrete visual elements."
): ProxyStructuredOutput {
	const rationale = sceneSummary.trim() || "Uniform image field.";
	return {
		contract: STRUCTURED_PROXY_CONTRACT_VERSION,
		sceneSummary: rationale,
		observations: ["Fallback plan: no discrete elements in model output."],
		recognizedText: [],
		layout: [],
		elements: [
			{
				elementId: "field-full-frame",
				label: "Image field",
				mode: "none",
				confidence: 0.55,
				rationale,
				observations: [],
				recognizedText: [],
				layout: [],
				regions: [
					{
						label: "full-frame",
						bbox: { x: 0, y: 0, w: 1000, h: 1000 },
						confidence: 0.55,
						priority: 1,
						rationale
					}
				]
			}
		]
	};
}

export function buildCompactStructuredSnapshot(plan: ProxyStructuredOutput): Record<string, unknown> {
	return {
		contract: plan.contract,
		sceneSummary: plan.sceneSummary,
		observations: plan.observations,
		recognizedText: plan.recognizedText,
		layout: plan.layout,
		elementCount: plan.elements.length,
		elements: plan.elements.map((element) => ({
			elementId: element.elementId,
			label: element.label,
			mode: element.mode,
			confidence: Number(element.confidence.toFixed(2)),
			rationale: element.rationale,
			regionCount: element.regions.length,
			regions: element.regions.slice(0, 8).map((region) => ({
				label: region.label,
				bbox: region.bbox,
				confidence: Number(region.confidence.toFixed(2)),
				priority: region.priority,
				rationale: region.rationale
			})),
			imageParams: element.imageParams ?? {},
			svgParams: element.svgParams ?? {},
			...(element.svgParams?.fillColor ? { fillColor: element.svgParams.fillColor } : {}),
			...(element.svgParams?.strokeWidth !== undefined ? { strokeWidth: element.svgParams.strokeWidth } : {})
		}))
	};
}
