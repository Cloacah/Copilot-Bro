import type { SvgPathFitSummary } from "./svgPathFitting";

export interface SvgGeometryValidationSummary {
	withinViewBox: boolean;
	viewBox?: { x: number; y: number; w: number; h: number };
	violatingPathIndexes: number[];
	warnings: string[];
}

export function validateSvgGeometry(svg: string, pathFit?: SvgPathFitSummary): SvgGeometryValidationSummary {
	const viewBox = parseViewBox(svg);
	const warnings: string[] = [];
	const violatingPathIndexes: number[] = [];

	if (!viewBox) {
		warnings.push("svgGeometry:missing_viewBox");
		return {
			withinViewBox: false,
			violatingPathIndexes,
			warnings
		};
	}

	if (pathFit) {
		for (const path of pathFit.paths) {
			if (!isBoundsWithinViewBox(path.bbox, viewBox)) {
				violatingPathIndexes.push(path.index);
			}
		}
	}

	if (violatingPathIndexes.length > 0) {
		warnings.push(`svgGeometry:paths_outside_viewBox=${violatingPathIndexes.join(",")}`);
	}

	return {
		withinViewBox: violatingPathIndexes.length === 0,
		viewBox,
		violatingPathIndexes,
		warnings
	};
}

function parseViewBox(svg: string): { x: number; y: number; w: number; h: number } | undefined {
	const match = svg.match(/\bviewBox=(["'])([-+]?\d*\.?\d+(?:e[-+]?\d+)?)[\s,]+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)[\s,]+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)[\s,]+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)(?:\1)/i);
	if (!match) {
		return undefined;
	}
	return {
		x: Number(match[2]),
		y: Number(match[3]),
		w: Number(match[4]),
		h: Number(match[5])
	};
}

function isBoundsWithinViewBox(bounds: { x: number; y: number; w: number; h: number }, viewBox: { x: number; y: number; w: number; h: number }): boolean {
	return bounds.x >= viewBox.x
		&& bounds.y >= viewBox.y
		&& bounds.x + bounds.w <= viewBox.x + viewBox.w
		&& bounds.y + bounds.h <= viewBox.y + viewBox.h;
}