import type { VisionOutputVerbosity, OpenAIMessage, VisionProcessingConfig } from "../types";
import { getImagePreprocessAdapter, getMlSegmentAdapter, getSvgOptimizeAdapter } from "./adapters/registry";
import type { MlSegmentResult } from "./adapters/types";
import type { ArtifactScoreSummary } from "./artifactScore";
import type { BlendOptions } from "./blending";
import type { DeformationOptions } from "./deformation";
import type { MaskQualitySummary } from "./maskQuality";
import type { StyleConsistencyOptions, StyleConsistencySummary } from "./styleConsistency";
import type { SvgPathFitSummary } from "./svgPathFitting";
import type { SvgStyleFidelitySummary } from "./svgStyleFidelity";
import type { SvgStructureValidationSummary } from "./svgStructureValidation";
import type { SvgGeometryValidationSummary } from "./svgGeometryValidation";
import { createVisionBatchHeader } from "./outputSemantics";
import { executeRestorationPipeline } from "./restorationPipeline";
import { decideVectorizationRoute } from "./vectorizationDecision";
import { vectorizeRasterBuffer } from "./rasterVectorizer";
import type { RasterVectorizeResult } from "./adapters/types";
import { ensureSvgViewBox } from "./visionSvgFidelity";
import { fitSvgPathsInSvg } from "./svgPathFitting";
import { evaluateSvgStyleFidelity } from "./svgStyleFidelity";
import { validateSvgStructure } from "./svgStructureValidation";
import { validateSvgGeometry } from "./svgGeometryValidation";
import type { VisionBatchResult, VisionResult } from "../visionProtocol/types";

export interface ProcessingChainInput {
	image?: Buffer;
	crop?: { x: number; y: number; w: number; h: number };
	resizeTo?: { width: number; height: number };
	svg?: string;
	deformation?: Partial<DeformationOptions>;
	blend?: Partial<BlendOptions>;
	style?: Partial<StyleConsistencyOptions>;
	artifact?: {
		threshold?: number;
	};
}

export interface ProcessingChainResult {
	image?: Buffer;
	svg?: string;
	rasterVectorize?: RasterVectorizeResult;
	mlSegments?: MlSegmentResult[];
	maskQuality?: MaskQualitySummary;
	styleConsistency?: StyleConsistencySummary;
	artifactScore?: ArtifactScoreSummary;
	svgPathFit?: SvgPathFitSummary;
	svgStyleFidelity?: SvgStyleFidelitySummary;
	svgStructureValidation?: SvgStructureValidationSummary;
	svgGeometryValidation?: SvgGeometryValidationSummary;
	warnings: string[];
}

export function assembleResult(
	batchResult: VisionBatchResult,
	originalMessages: OpenAIMessage[],
	verbosity: VisionOutputVerbosity = "balanced"
): OpenAIMessage[] {
	const content = [
		createVisionBatchHeader(batchResult.batchId, batchResult.sessionId),
		...batchResult.results.map((result) => formatVisionOutput(result, verbosity)),
		batchResult.failedRefs.length > 0 ? `failedRefs=${batchResult.failedRefs.join(",")}` : "failedRefs=none"
	].join("\n\n");
	return [
		...originalMessages,
		{
			role: "assistant",
			content
		}
	];
}

export function formatVisionOutput(result: VisionResult, verbosity: VisionOutputVerbosity): string {
	const header = `imageRef=${result.imageRef} hash=${result.imageHash} objects=${result.objects.length}`;
	if (verbosity === "conservative") {
		return [header, ...result.objects.map((object) => `- ${object.label}`)].join("\n");
	}
	if (verbosity === "balanced") {
		return [
			header,
			...result.objects.map((object) => `- ${object.label} @ (${object.geometry.bbox.x},${object.geometry.bbox.y},${object.geometry.bbox.w},${object.geometry.bbox.h}) reason=${object.rationale ?? object.geometry.rationale}`)
		].join("\n");
	}
	return [
		header,
		...result.objects.map((object) => `- ${object.label} geometry=${JSON.stringify(object.geometry)} rationale=${object.rationale ?? object.geometry.rationale} attributes=${JSON.stringify(object.attributes ?? {})}`)
	].join("\n");
}

async function downscaleBufferForVectorize(buffer: Buffer, maxEdgePx: number | undefined): Promise<Buffer> {
	if (!maxEdgePx || maxEdgePx <= 0) {
		return buffer;
	}
	const sharpModule = loadSharp();
	const meta = await sharpModule(buffer).metadata();
	const w = meta.width ?? 1;
	const h = meta.height ?? 1;
	const longEdge = Math.max(w, h);
	if (longEdge <= maxEdgePx) {
		return buffer;
	}
	const scale = maxEdgePx / longEdge;
	return sharpModule(buffer)
		.resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), { fit: "inside" })
		.png()
		.toBuffer();
}

function loadSharp(): typeof import("sharp") {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require("sharp") as typeof import("sharp");
}

export async function runProcessingChain(
	input: ProcessingChainInput,
	config: Pick<VisionProcessingConfig, "imagePreprocess" | "svgOptimize" | "mlSegment">
		& Partial<Pick<VisionProcessingConfig, "svgDecisionPolicy" | "rasterPolicy" | "rasterVectorize" | "maxVectorizeEdgePx">>
): Promise<ProcessingChainResult> {
	let image = input.image;
	let svg = input.svg;
	let mlSegments: MlSegmentResult[] | undefined;
	let maskQuality: MaskQualitySummary | undefined;
	let styleConsistency: StyleConsistencySummary | undefined;
	let artifactScore: ArtifactScoreSummary | undefined;
	let svgPathFit: SvgPathFitSummary | undefined;
	let svgStyleFidelity: SvgStyleFidelitySummary | undefined;
	let svgStructureValidation: SvgStructureValidationSummary | undefined;
	let svgGeometryValidation: SvgGeometryValidationSummary | undefined;
	const warnings: string[] = [];
	const originalSvg = svg;
	const routeDecision = decideVectorizationRoute({
		hasSvgInput: Boolean(svg && svg.trim().length > 0),
		hasRasterImage: Boolean(image),
		svgOptimizeEnabled: config.svgOptimize,
		mlSegmentEnabled: config.mlSegment,
		rasterVectorizeEnabled: config.rasterVectorize,
		svgDecisionPolicy: config.svgDecisionPolicy,
		rasterPolicy: config.rasterPolicy
	});
	let rasterVectorize: RasterVectorizeResult | undefined;

	if (image && config.imagePreprocess) {
		try {
			const adapter = getImagePreprocessAdapter();
			if (input.crop) {
				image = await adapter.crop(image, input.crop.x, input.crop.y, input.crop.w, input.crop.h);
			}
			if (input.resizeTo) {
				image = await adapter.resize(image, input.resizeTo.width, input.resizeTo.height);
			}
		} catch (error) {
			warnings.push(`imagePreprocess:${toWarningMessage(error)}`);
		}
	}

	if (image && routeDecision.shouldRunRasterVectorize) {
		try {
			const vectorInput = await downscaleBufferForVectorize(image, config.maxVectorizeEdgePx);
			rasterVectorize = await vectorizeRasterBuffer(vectorInput);
			svg = rasterVectorize.svg;
			warnings.push(`rasterVectorize:${rasterVectorize.engine}:paths=${rasterVectorize.pathCount}`);
			if (svg) {
				svg = ensureSvgViewBox(svg, rasterVectorize.width, rasterVectorize.height);
			}
		} catch (error) {
			warnings.push(`rasterVectorize:${toWarningMessage(error)}`);
		}
	}

	const shouldOptimizeSvgOutput = config.svgOptimize
		&& Boolean(svg?.trim())
		&& (routeDecision.shouldOptimizeSvg || Boolean(rasterVectorize));
	if (svg && shouldOptimizeSvgOutput) {
		try {
			svg = await getSvgOptimizeAdapter().optimize(svg);
			const fitted = fitSvgPathsInSvg(svg);
			svg = fitted.svg;
			svgPathFit = fitted.summary;
			warnings.push(...svgPathFit.warnings);
			svgStyleFidelity = evaluateSvgStyleFidelity(originalSvg ?? svg, svg);
			warnings.push(...svgStyleFidelity.warnings);
			svgStructureValidation = validateSvgStructure(svg);
			warnings.push(...svgStructureValidation.warnings);
			svgGeometryValidation = validateSvgGeometry(svg, svgPathFit);
			warnings.push(...svgGeometryValidation.warnings);
		} catch (error) {
			warnings.push(`svgOptimize:${toWarningMessage(error)}`);
		}
	}

	if (image && routeDecision.shouldRunMlSegment) {
		try {
			const mlAdapter = getMlSegmentAdapter({ mlSegment: true });
			const restoration = await executeRestorationPipeline({
				image,
				mlSegmentAdapter: mlAdapter,
				deformation: input.deformation,
				blend: input.blend,
				style: input.style,
				artifact: input.artifact
			});
			mlSegments = restoration.mlSegments;
			maskQuality = restoration.maskQuality;
			styleConsistency = restoration.styleConsistency;
			artifactScore = restoration.artifactScore;
			warnings.push(...restoration.warnings);
		} catch (error) {
			warnings.push(`mlSegment:${toWarningMessage(error)}`);
		}
	}

	if (svg && rasterVectorize && !svgPathFit) {
		const fitted = fitSvgPathsInSvg(svg);
		svg = fitted.svg;
		svgPathFit = fitted.summary;
		svgStructureValidation = validateSvgStructure(svg);
		svgGeometryValidation = validateSvgGeometry(svg, svgPathFit);
		warnings.push(...fitted.summary.warnings, ...(svgStructureValidation?.warnings ?? []), ...(svgGeometryValidation?.warnings ?? []));
	}

	return {
		image,
		svg,
		rasterVectorize,
		mlSegments,
		maskQuality,
		styleConsistency,
		artifactScore,
		svgPathFit,
		svgStyleFidelity,
		svgStructureValidation,
		svgGeometryValidation,
		warnings
	};
}

function toWarningMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}