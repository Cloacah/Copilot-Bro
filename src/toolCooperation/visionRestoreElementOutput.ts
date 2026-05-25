import type { ProxyBBox, ProxyVisualElement } from "../visionProxyStructuredPlan";
import { clampProxyBBoxToImage } from "../visionProxyBBox";
import type { ExtensionSettings } from "../types";

/** Settings used by restore benchmarks and host-ui restore probes (no LLM). */
export function defaultRestoreBenchmarkSettings(): Pick<ExtensionSettings, "visionIntegrity" | "visionProcessing"> {
	return {
		visionIntegrity: {
			enabled: true,
			strictIntegrity: false,
			certaintyThreshold: 0.6,
			checkCount: true,
			checkDimensions: true,
			checkDigest: true,
			trackResize: true,
			trackByteSummary: true,
			roiMode: "full",
			tileMaxPixels: 1024 * 1024,
			detailPriority: "balanced"
		},
		visionProcessing: {
			svgOptimize: true,
			imagePreprocess: true,
			mlSegment: false,
			outputVerbosity: "balanced",
			chatDebugVisibility: false,
			tokenBudgetMode: "balanced",
			needVisionGate: true,
			svgDecisionPolicy: "auto",
			rasterPolicy: "auto",
			spatialSchemaVersion: "1",
			highFidelityPrompt: "",
			rasterVectorize: true,
			maxVectorizeEdgePx: 512
		}
	};
}
import { getImageAnalyzeAdapter } from "./adapters/registry";
import { applyOptionalVisionThreshold } from "./visionThresholdFallback";
import { validateImageIntegrity } from "../providerVisionIntegrity";
import { createHash } from "node:crypto";
import { runProcessingChain, type ProcessingChainResult } from "./resultAssembler";
import { buildVisionRestoreFidelityReport, type VisionRestoreFidelityReport } from "./visionRestoreFidelityReport";
import { resolveProductionSvgOutput, isBboxPlaceholderSvg } from "./visionSvgFidelity";
import { resolveHintedSvgFromElement } from "../visionRestoreSeed";

export interface RestoreElementOutputResult {
	readonly bbox: ProxyBBox;
	readonly mode: ProxyVisualElement["mode"];
	/** Pixel-accurate crop for composite / matting path (always produced). */
	readonly productionPng: Buffer;
	/** Vector artifact when mode=svg and tracing succeeds. */
	readonly productionSvg?: string;
	readonly rasterChain: ProcessingChainResult;
	readonly svgChain?: ProcessingChainResult;
	readonly fidelityReport?: VisionRestoreFidelityReport;
	readonly integrityWarnings: string[];
	readonly warnings: string[];
	readonly usedPlaceholder: boolean;
	readonly svgStructuralPassed: boolean;
}

/**
 * Per-element restore: matting (image) and/or SVG paths.
 * - `mode=image` → raster crop only (抠图).
 * - `mode=svg` → raster crop for pixel fidelity + optional SVG trace on the crop.
 */
export async function produceRestoreElementOutputs(input: {
	readonly original: Buffer;
	readonly element: ProxyVisualElement;
	readonly imageWidth: number;
	readonly imageHeight: number;
	readonly settings: Pick<ExtensionSettings, "visionIntegrity" | "visionProcessing">;
	readonly allowBBoxPlaceholderSvg?: boolean;
}): Promise<RestoreElementOutputResult> {
	const rawBbox = input.element.imageParams?.crop ?? input.element.regions[0]?.bbox;
	if (!rawBbox) {
		throw new Error(`restore: element ${input.element.elementId} missing bbox`);
	}
	const bbox = clampProxyBBoxToImage(rawBbox, input.imageWidth, input.imageHeight);
	const analyzer = getImageAnalyzeAdapter();
	const warnings: string[] = [];
	const hintedSvg = resolveHintedSvgFromElement(input.element, bbox);

	const rasterChain = await runProcessingChain(
		{
			image: Buffer.from(input.original),
			crop: bbox,
			resizeTo: input.element.imageParams?.resize,
			svg: undefined
		},
		{
			imagePreprocess: true,
			svgOptimize: false,
			mlSegment: input.settings.visionProcessing.mlSegment,
			rasterVectorize: false,
			svgDecisionPolicy: "never",
			rasterPolicy: "auto",
			maxVectorizeEdgePx: input.settings.visionProcessing.maxVectorizeEdgePx
		}
	);

	let productionPng: Buffer = Buffer.from(rasterChain.image ?? Buffer.alloc(0));
	if (!productionPng.length) {
		productionPng = Buffer.from(await cropOriginal(input.original, bbox));
	}
	warnings.push(...rasterChain.warnings);

	if (typeof input.element.imageParams?.threshold === "number") {
		productionPng = Buffer.from(
			await applyOptionalVisionThreshold(
				analyzer,
				productionPng,
				input.element.imageParams.threshold,
				warnings,
				{ warn: () => undefined }
			)
		);
	}

	const originalDigest = createHash("sha256").update(input.original).digest("hex");
	const candidateDigest = createHash("sha256").update(productionPng).digest("hex");
	const imageMeta = await safeImageMeta(analyzer, input.original);
	const candidateMeta = await safeImageMeta(analyzer, productionPng);
	const integrityWarnings = validateImageIntegrity(
		input.settings,
		input.original,
		productionPng,
		originalDigest,
		candidateDigest,
		imageMeta,
		candidateMeta
	);
	warnings.push(...integrityWarnings);

	let svgChain: ProcessingChainResult | undefined;
	let productionSvg: string | undefined;
	let fidelityReport: VisionRestoreFidelityReport | undefined;
	let usedPlaceholder = false;

	if (input.element.mode === "svg") {
		svgChain = await runProcessingChain(
			{
				image: Buffer.from(productionPng),
				svg: hintedSvg
			},
			{
				imagePreprocess: false,
				svgOptimize: true,
				mlSegment: false,
				rasterVectorize: input.settings.visionProcessing.rasterVectorize !== false,
				svgDecisionPolicy: "always",
				rasterPolicy: "skip",
				maxVectorizeEdgePx: input.settings.visionProcessing.maxVectorizeEdgePx
			}
		);
		warnings.push(...svgChain.warnings);
		const resolved = resolveProductionSvgOutput(
			svgChain.svg,
			hintedSvg,
			input.allowBBoxPlaceholderSvg === true
		);
		fidelityReport = buildVisionRestoreFidelityReport({
			elementId: input.element.elementId,
			bbox,
			rasterVectorize: svgChain.rasterVectorize,
			chain: svgChain,
			resolvedSvg: resolved.svg
		});
		productionSvg = fidelityReport.effectiveSvg ?? resolved.svg;
		usedPlaceholder = resolved.usedPlaceholder;
	}

	const svgStructuralPassed = input.element.mode === "image"
		? true
		: Boolean(productionSvg) && !isBboxPlaceholderSvg(productionSvg) && (fidelityReport?.passed ?? false);

	return {
		bbox,
		mode: input.element.mode,
		productionPng,
		productionSvg,
		rasterChain,
		svgChain,
		fidelityReport,
		integrityWarnings,
		warnings,
		usedPlaceholder,
		svgStructuralPassed
	};
}

export function isRestoreElementOutputAcceptable(
	output: RestoreElementOutputResult,
	options: { requireSvgStructural?: boolean } = {}
): boolean {
	if (output.integrityWarnings.length > 0 || !output.productionPng.length) {
		return false;
	}
	if (output.mode === "image") {
		return true;
	}
	if (!output.productionSvg || isBboxPlaceholderSvg(output.productionSvg)) {
		return false;
	}
	if (options.requireSvgStructural === false) {
		return true;
	}
	return output.svgStructuralPassed;
}

async function cropOriginal(original: Buffer, bbox: ProxyBBox): Promise<Buffer> {
	const sharp = loadSharp();
	return sharp(original)
		.extract({
			left: Math.max(0, Math.round(bbox.x)),
			top: Math.max(0, Math.round(bbox.y)),
			width: Math.max(1, Math.round(bbox.w)),
			height: Math.max(1, Math.round(bbox.h))
		})
		.png()
		.toBuffer();
}

async function safeImageMeta(
	analyzer: ReturnType<typeof getImageAnalyzeAdapter>,
	buffer: Buffer
): Promise<{ width: number; height: number } | undefined> {
	try {
		const meta = await analyzer.getMetadata(buffer);
		return { width: meta.width, height: meta.height };
	} catch {
		return undefined;
	}
}

function loadSharp(): typeof import("sharp") {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require("sharp") as typeof import("sharp");
}
