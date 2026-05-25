import type { ProxyBBox, ProxyVisualElement } from "./visionProxyStructuredPlan";

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Optional LLM-provided SVG/path hint only. Production restore must not use bbox-rect seed SVG.
 */
export function resolveHintedSvgFromElement(element: ProxyVisualElement, region: ProxyBBox): string | undefined {
	const pathHint = element.svgParams?.pathHint?.trim();
	if (pathHint && /<svg[\s>]/iu.test(pathHint)) {
		return pathHint;
	}
	const width = Math.max(1, region.w);
	const height = Math.max(1, region.h);
	if (pathHint && /^M[\d\s.,+-]+/iu.test(pathHint)) {
		return [
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`,
			`<path d="${escapeXml(pathHint)}" fill="${element.svgParams?.fillColor ?? "#3366CC"}"/>`,
			"</svg>"
		].join("");
	}
	return undefined;
}

/** @deprecated Use rasterVectorize + resolveHintedSvgFromElement; kept for tests importing the name. */
export function buildRestoreSeedSvg(element: ProxyVisualElement, region: ProxyBBox): string {
	return resolveHintedSvgFromElement(element, region) ?? "";
}
