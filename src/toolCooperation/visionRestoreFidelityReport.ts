import type { ArtifactScoreSummary } from "./artifactScore";
import type { MaskQualitySummary } from "./maskQuality";
import type { ProcessingChainResult } from "./resultAssembler";
import type { RasterVectorizeResult } from "./rasterVectorizer";
import { expandSvgViewBoxToPathBounds, isBboxPlaceholderSvg } from "./visionSvgFidelity";
import { validateSvgGeometry } from "./svgGeometryValidation";
import { validateSvgStructure } from "./svgStructureValidation";
import type { SvgGeometryValidationSummary } from "./svgGeometryValidation";
import type { SvgStructureValidationSummary } from "./svgStructureValidation";

export interface VisionRestoreFidelityReport {
	contract: "vision-restore-fidelity-v1";
	elementId?: string;
	bbox?: { x: number; y: number; w: number; h: number };
	rasterVectorize?: {
		engine: string;
		pathCount: number;
		width: number;
		height: number;
	};
	svg?: {
		pathCount: number;
		isBboxPlaceholder: boolean;
		structureValid?: boolean;
		geometryWithinViewBox?: boolean;
	};
	maskQuality?: {
		iouSurrogate: number;
		boundaryFSurrogate: number;
	};
	artifactScore?: {
		aggregateScore: number;
		exceeded: boolean;
	};
	warnings: string[];
	passed: boolean;
	failureReasons: string[];
	/** SVG after viewBox remediation (may equal input resolvedSvg). */
	effectiveSvg?: string;
}

export function buildVisionRestoreFidelityReport(input: {
	elementId?: string;
	bbox?: { x: number; y: number; w: number; h: number };
	rasterVectorize?: RasterVectorizeResult;
	chain: Pick<
		ProcessingChainResult,
		| "svg"
		| "warnings"
		| "maskQuality"
		| "artifactScore"
		| "svgPathFit"
		| "svgStructureValidation"
		| "svgGeometryValidation"
	>;
	resolvedSvg?: string;
}): VisionRestoreFidelityReport {
	let svgText = input.resolvedSvg?.trim() ?? input.chain.svg?.trim() ?? "";
	const pathCount = (svgText.match(/<path\b/giu) ?? []).length;
	const isPlaceholder = isBboxPlaceholderSvg(svgText);
	let pathFit = input.chain.svgPathFit;
	if (svgText && pathFit?.paths.length) {
		const expanded = expandSvgViewBoxToPathBounds(svgText, pathFit);
		if (expanded !== svgText) {
			svgText = expanded;
		}
	}
	const structure: SvgStructureValidationSummary | undefined = svgText
		? validateSvgStructure(svgText)
		: input.chain.svgStructureValidation as SvgStructureValidationSummary | undefined;
	let geometry: SvgGeometryValidationSummary | undefined = svgText
		? validateSvgGeometry(svgText, pathFit)
		: input.chain.svgGeometryValidation as SvgGeometryValidationSummary | undefined;
	if (geometry && geometry.withinViewBox === false && svgText && pathFit?.paths.length) {
		const expanded = expandSvgViewBoxToPathBounds(svgText, pathFit);
		if (expanded !== svgText) {
			svgText = expanded;
			geometry = validateSvgGeometry(svgText, pathFit);
		}
	}
	const failureReasons: string[] = [];
	if (!svgText) {
		failureReasons.push("missing-svg-output");
	}
	if (isPlaceholder) {
		failureReasons.push("bbox-placeholder-svg");
	}
	if (pathCount === 0 && svgText) {
		failureReasons.push("no-path-elements");
	}
	if (input.rasterVectorize && input.rasterVectorize.pathCount === 0) {
		failureReasons.push("raster-vectorize-zero-paths");
	}
	if (structure && !structure.valid) {
		failureReasons.push("svg-structure-invalid");
	}
	if (geometry && geometry.withinViewBox === false) {
		failureReasons.push("svg-geometry-outside-viewbox");
	}
	if (input.chain.artifactScore?.exceeded) {
		failureReasons.push("artifact-score-threshold-exceeded");
	}
	return {
		contract: "vision-restore-fidelity-v1",
		elementId: input.elementId,
		bbox: input.bbox,
		rasterVectorize: input.rasterVectorize
			? {
				engine: input.rasterVectorize.engine,
				pathCount: input.rasterVectorize.pathCount,
				width: input.rasterVectorize.width,
				height: input.rasterVectorize.height
			}
			: undefined,
		svg: svgText
			? {
				pathCount,
				isBboxPlaceholder: isPlaceholder,
				structureValid: structure?.valid,
				geometryWithinViewBox: geometry?.withinViewBox
			}
			: undefined,
		maskQuality: input.chain.maskQuality
			? {
				iouSurrogate: input.chain.maskQuality.aggregate.iouSurrogate,
				boundaryFSurrogate: input.chain.maskQuality.aggregate.boundaryFSurrogate
			}
			: undefined,
		artifactScore: input.chain.artifactScore
			? {
				aggregateScore: input.chain.artifactScore.aggregateScore,
				exceeded: input.chain.artifactScore.exceeded
			}
			: undefined,
		warnings: [...input.chain.warnings],
		passed: failureReasons.length === 0,
		failureReasons,
		effectiveSvg: svgText || undefined
	};
}
