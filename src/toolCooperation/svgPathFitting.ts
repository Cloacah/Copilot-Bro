import type { AdapterGeometryBounds } from "./adapters/types";
import { getSvgPathAdapter } from "./adapters/registry";

export interface SvgPathFitMetric {
	index: number;
	closed: boolean;
	segmentCount: number;
	continuityScore: number;
	bbox: AdapterGeometryBounds;
}

export interface SvgPathFitSummary {
	pathCount: number;
	closedPathCount: number;
	aggregateContinuityScore: number;
	paths: SvgPathFitMetric[];
	warnings: string[];
}

export interface SvgPathFitResult {
	svg: string;
	summary: SvgPathFitSummary;
}

export function fitSvgPathsInSvg(svg: string): SvgPathFitResult {
	const warnings: string[] = [];
	let pathIndex = 0;
	let closedPathCount = 0;
	const metrics: SvgPathFitMetric[] = [];
	const fittedSvg = svg.replace(/(<path\b[^>]*\bd=)(["'])([^"']*)(\2)([^>]*>)/gi, (match, prefix: string, quote: string, pathData: string, closingQuote: string, suffix: string) => {
		try {
			const fitted = fitSvgPathData(pathData);
			metrics.push({
				index: pathIndex,
				closed: fitted.closed,
				segmentCount: fitted.segmentCount,
				continuityScore: fitted.continuityScore,
				bbox: fitted.bbox
			});
			if (fitted.closed) {
				closedPathCount += 1;
			}
			warnings.push(...fitted.warnings.map((warning) => `svgPath:${pathIndex}:${warning}`));
			pathIndex += 1;
			return `${prefix}${quote}${fitted.fittedPath}${closingQuote}${suffix}`;
		} catch (error) {
			warnings.push(`svgPath:${pathIndex}:${toWarningMessage(error)}`);
			pathIndex += 1;
			return match;
		}
	});

	return {
		svg: fittedSvg,
		summary: {
			pathCount: metrics.length,
			closedPathCount,
			aggregateContinuityScore: average(metrics.map((metric) => metric.continuityScore)),
			paths: metrics,
			warnings
		}
	};
}

export function fitSvgPathData(pathData: string): SvgPathFitMetric & { fittedPath: string; warnings: string[] } {
	const warnings: string[] = [];
	const adapter = getSvgPathAdapter();
	const normalized = adapter.normalize(pathData);
	const bbox = adapter.getBBox(normalized);
	const analysis = analyzeSvgPath(normalized);
	if (!analysis.closed) {
		warnings.push("topology_open_path");
	}
	if (analysis.segmentCount === 0) {
		warnings.push("topology_empty_path");
	}
	return {
		index: 0,
		closed: analysis.closed,
		segmentCount: analysis.segmentCount,
		continuityScore: analysis.continuityScore,
		bbox,
		fittedPath: normalized,
		warnings
	};
}

interface SvgPathAnalysis {
	closed: boolean;
	segmentCount: number;
	continuityScore: number;
}

function analyzeSvgPath(pathData: string): SvgPathAnalysis {
	const commands = tokenizePath(pathData);
	if (commands.length === 0) {
		return {
			closed: false,
			segmentCount: 0,
			continuityScore: 0
		};
	}

	const subpaths: Array<{ start: Point; end: Point; closed: boolean }> = [];
	let currentPoint: Point | undefined;
	let subpathStart: Point | undefined;
	let closed = false;
	let segmentCount = 0;
	let hasSegments = false;

	for (const command of commands) {
		switch (command.type) {
			case "M":
				currentPoint = { x: command.points[0].x, y: command.points[0].y };
				subpathStart = currentPoint;
				break;
			case "L":
				if (currentPoint) {
					segmentCount += 1;
					hasSegments = true;
				}
				currentPoint = command.points[0];
				break;
			case "H":
				if (currentPoint) {
					const nextPoint = { x: command.points[0].x, y: currentPoint.y };
					segmentCount += 1;
					hasSegments = true;
					currentPoint = nextPoint;
				}
				break;
			case "V":
				if (currentPoint) {
					const nextPoint = { x: currentPoint.x, y: command.points[0].y };
					segmentCount += 1;
					hasSegments = true;
					currentPoint = nextPoint;
				}
				break;
			case "Z":
				if (currentPoint && subpathStart) {
					segmentCount += 1;
					hasSegments = true;
					currentPoint = subpathStart;
					closed = true;
					const end = currentPoint;
					subpaths.push({ start: subpathStart, end, closed: true });
				}
				break;
		}
	}

	const continuityScore = closed ? 1 : hasSegments ? 0.5 : 0;
	return {
		closed,
		segmentCount,
		continuityScore
	};
}

type Point = { x: number; y: number };

type TokenCommand = {
	type: "M" | "L" | "H" | "V" | "Z";
	points: Point[];
};

function tokenizePath(pathData: string): TokenCommand[] {
	const tokens: TokenCommand[] = [];
	const matches = pathData.match(/[MmLlHhVvZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
	if (!matches) {
		return tokens;
	}

	let cursor = 0;
	let currentPoint: Point = { x: 0, y: 0 };
	while (cursor < matches.length) {
		const token = matches[cursor++];
		switch (token) {
			case "M":
			case "m": {
				const x = toNumber(matches[cursor++]);
				const y = toNumber(matches[cursor++]);
				currentPoint = token === "m" ? { x: currentPoint.x + x, y: currentPoint.y + y } : { x, y };
				tokens.push({ type: "M", points: [currentPoint] });
				break;
			}
			case "L":
			case "l": {
				const x = toNumber(matches[cursor++]);
				const y = toNumber(matches[cursor++]);
				currentPoint = token === "l" ? { x: currentPoint.x + x, y: currentPoint.y + y } : { x, y };
				tokens.push({ type: "L", points: [currentPoint] });
				break;
			}
			case "H":
			case "h": {
				const x = toNumber(matches[cursor++]);
				currentPoint = token === "h" ? { x: currentPoint.x + x, y: currentPoint.y } : { x, y: currentPoint.y };
				tokens.push({ type: "H", points: [currentPoint] });
				break;
			}
			case "V":
			case "v": {
				const y = toNumber(matches[cursor++]);
				currentPoint = token === "v" ? { x: currentPoint.x, y: currentPoint.y + y } : { x: currentPoint.x, y };
				tokens.push({ type: "V", points: [currentPoint] });
				break;
			}
			case "Z":
			case "z":
				tokens.push({ type: "Z", points: [] });
				break;
			default:
				break;
		}
	}

	return tokens;
}

function distance(a: Point, b: Point): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function average(values: readonly number[]): number {
	if (values.length === 0) {
		return 0;
	}
	const sum = values.reduce((acc, value) => acc + value, 0);
	return clamp01(sum / values.length);
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}

function toNumber(value: string | undefined): number {
	if (!value) {
		return 0;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function toWarningMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}