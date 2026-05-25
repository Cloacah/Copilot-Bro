/**
 * Detects bbox-only placeholder SVG (plan p7: must not ship as production vector output).
 */
import type { SvgPathFitSummary } from "./svgPathFitting";

const PLACEHOLDER_RECT_ONLY = /<rect\b[^>]*\/?>/iu;
const PATH_TAG = /<path\b/iu;

/** Expand viewBox to include all fitted path bounds (fixes text/icon open-path geometry false negatives). */
export function expandSvgViewBoxToPathBounds(svg: string, pathFit: SvgPathFitSummary): string {
	if (!pathFit.paths.length || !/<svg\b/iu.test(svg)) {
		return svg;
	}
	const viewBoxMatch = svg.match(/\bviewBox=(["'])([-+]?\d*\.?\d+)[\s,]+([-+]?\d*\.?\d+)[\s,]+([-+]?\d*\.?\d+)[\s,]+([-+]?\d*\.?\d+)\1/iu);
	let minX = 0;
	let minY = 0;
	let maxX = 0;
	let maxY = 0;
	if (viewBoxMatch) {
		minX = Number(viewBoxMatch[2]);
		minY = Number(viewBoxMatch[3]);
		maxX = minX + Number(viewBoxMatch[4]);
		maxY = minY + Number(viewBoxMatch[5]);
	}
	for (const path of pathFit.paths) {
		minX = Math.min(minX, path.bbox.x);
		minY = Math.min(minY, path.bbox.y);
		maxX = Math.max(maxX, path.bbox.x + path.bbox.w);
		maxY = Math.max(maxY, path.bbox.y + path.bbox.h);
	}
	const w = Math.max(1, maxX - minX);
	const h = Math.max(1, maxY - minY);
	const replacement = `viewBox="${minX} ${minY} ${w} ${h}"`;
	if (viewBoxMatch) {
		return svg.replace(/\bviewBox=(["'])([^"']*)(\1)/iu, replacement);
	}
	return svg.replace(/<svg\b/iu, `<svg ${replacement}`);
}

export function ensureSvgViewBox(svg: string, width: number, height: number): string {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	if (/\bviewBox\s*=/iu.test(svg)) {
		return svg;
	}
	if (!/<svg\b/iu.test(svg)) {
		return svg;
	}
	return svg.replace(/<svg\b/iu, `<svg viewBox="0 0 ${w} ${h}"`);
}

export function isBboxPlaceholderSvg(svg: string | undefined): boolean {
	if (!svg?.trim()) {
		return false;
	}
	const normalized = svg.trim();
	if (!/<svg\b/iu.test(normalized)) {
		return false;
	}
	const pathMatches = normalized.match(PATH_TAG);
	if (pathMatches && pathMatches.length > 0) {
		return false;
	}
	const rectMatches = normalized.match(/<rect\b/giu);
	if (!rectMatches || rectMatches.length === 0) {
		return false;
	}
	return rectMatches.length <= 2 && !/<polygon\b|<polyline\b|<circle\b|<ellipse\b/iu.test(normalized);
}

export function resolveProductionSvgOutput(
	candidateSvg: string | undefined,
	placeholderSvg: string | undefined,
	allowBBoxPlaceholderSvg: boolean
): { svg?: string; usedPlaceholder: boolean; rejectedPlaceholder: boolean } {
	const trimmed = candidateSvg?.trim();
	if (trimmed && !isBboxPlaceholderSvg(trimmed)) {
		return { svg: trimmed, usedPlaceholder: false, rejectedPlaceholder: false };
	}
	if (allowBBoxPlaceholderSvg && placeholderSvg?.trim()) {
		return { svg: placeholderSvg, usedPlaceholder: true, rejectedPlaceholder: false };
	}
	return { svg: undefined, usedPlaceholder: false, rejectedPlaceholder: true };
}
