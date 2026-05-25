import type { ProxyBBox, ProxyStructuredOutput, ProxyVisualElement } from "../visionProxyStructuredPlan";
import { compareImageBuffers, type ImageSimilarityReport } from "./imageSimilarity";
import type { ProcessingChainResult } from "./resultAssembler";
import {
	buildElementBenchmarkMetrics,
	type VisionRestoreBenchmarkBudget,
	type VisionRestoreElementBenchmarkMetrics
} from "./visionRestoreBenchmarkMetrics";
import { exportVisionRestoreWebPage, type VisionRestorePageLayer } from "./visionRestorePageComposer";
import {
	defaultRestoreBenchmarkSettings,
	isRestoreElementOutputAcceptable,
	produceRestoreElementOutputs
} from "./visionRestoreElementOutput";
import type { ExtensionSettings } from "../types";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { sampleUncoveredBackgroundRgb, screenshotHtmlFileToPng } from "./visionRestoreWebPageScreenshot";

export interface ElementRestoreBenchmarkResult {
	readonly element: ProxyVisualElement;
	readonly bbox: ProxyBBox;
	readonly chain: ProcessingChainResult;
	readonly rasterChain: ProcessingChainResult;
	readonly svgChain?: ProcessingChainResult;
	readonly productionPng: Buffer;
	readonly productionSvg?: string;
	readonly similarity: ImageSimilarityReport;
	readonly metrics: VisionRestoreElementBenchmarkMetrics;
}

export async function runElementRestoreBenchmark(input: {
	readonly sourceImage: Buffer;
	readonly element: ProxyVisualElement;
	readonly imageWidth: number;
	readonly imageHeight: number;
	readonly similarityThreshold?: number;
	readonly allowBBoxPlaceholderSvg?: boolean;
	readonly settings?: Pick<ExtensionSettings, "visionIntegrity" | "visionProcessing">;
}): Promise<ElementRestoreBenchmarkResult> {
	const started = Date.now();
	const threshold = input.similarityThreshold ?? 0.99;
	const settings = input.settings ?? defaultRestoreBenchmarkSettings();

	const outputs = await produceRestoreElementOutputs({
		original: input.sourceImage,
		element: input.element,
		imageWidth: input.imageWidth,
		imageHeight: input.imageHeight,
		settings,
		allowBBoxPlaceholderSvg: input.allowBBoxPlaceholderSvg
	});

	const referenceCrop = await cropBuffer(input.sourceImage, outputs.bbox);
	const similarity = await compareImageBuffers(referenceCrop, outputs.productionPng, {
		threshold
	});

	const chain = outputs.svgChain ?? outputs.rasterChain;
	const fidelityPassed =
		similarity.passed
		&& isRestoreElementOutputAcceptable(outputs, { requireSvgStructural: false });

	const metrics = buildElementBenchmarkMetrics({
		elementId: input.element.elementId,
		mode: input.element.mode,
		similarity,
		chain,
		fidelityPassed,
		processingMs: Date.now() - started
	});

	return {
		element: input.element,
		bbox: outputs.bbox,
		chain,
		rasterChain: outputs.rasterChain,
		svgChain: outputs.svgChain,
		productionPng: outputs.productionPng,
		productionSvg: outputs.productionSvg,
		similarity,
		metrics
	};
}

export async function runPageRestoreBenchmark(input: {
	readonly sourceImage: Buffer;
	readonly plan: ProxyStructuredOutput;
	readonly imageWidth: number;
	readonly imageHeight: number;
	readonly budget?: Partial<VisionRestoreBenchmarkBudget>;
	readonly settings?: Pick<ExtensionSettings, "visionIntegrity" | "visionProcessing">;
	/**
	 * Directory that contains `node_modules/playwright` (repo root in dev / smoke).
	 * Temp HTML is written under `<root>/artifacts/host-ui/.benchmark-web-render/`.
	 */
	readonly playwrightResolveRoot?: string;
}): Promise<{
	readonly elementResults: readonly ElementRestoreBenchmarkResult[];
	/** Chromium screenshot of the exported HTML (no source image as raster underlay). */
	readonly pagePng: Buffer;
	readonly pageHtml: string;
	readonly pageSimilarity: ImageSimilarityReport;
}> {
	const threshold = input.budget?.minCompositeSimilarity ?? 0.99;
	const elementResults: ElementRestoreBenchmarkResult[] = [];
	const layers: VisionRestorePageLayer[] = [];

	for (const element of input.plan.elements) {
		if (element.mode === "none") {
			continue;
		}
		try {
			const result = await runElementRestoreBenchmark({
				sourceImage: input.sourceImage,
				element,
				imageWidth: input.imageWidth,
				imageHeight: input.imageHeight,
				similarityThreshold: threshold,
				settings: input.settings,
				allowBBoxPlaceholderSvg: input.settings?.visionProcessing?.allowBBoxPlaceholderSvg === true
			});
			elementResults.push(result);
			layers.push({
				elementId: element.elementId,
				bbox: result.bbox,
				png: result.productionPng
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`benchmark element ${element.elementId} failed: ${message}`);
		}
	}

	const workRoot =
		input.playwrightResolveRoot?.trim()
		?? process.env.COPILOT_BRO_UI_SMOKE_REPO_ROOT?.trim()
		?? process.cwd();
	const playwrightRoots = [workRoot, process.cwd()].filter((v, i, a) => a.indexOf(v) === i);

	const cornerBg = await sampleUncoveredBackgroundRgb(
		input.sourceImage,
		layers.map((l) => l.bbox)
	);
	const { html } = await exportVisionRestoreWebPage({
		width: input.imageWidth,
		height: input.imageHeight,
		background: { ...cornerBg, alpha: 1 },
		layers
	});

	const tmpDir = path.join(workRoot, "artifacts", "host-ui", ".benchmark-web-render");
	await mkdir(tmpDir, { recursive: true });
	const htmlPath = path.join(tmpDir, `bench-${Date.now()}-${process.pid}.html`);
	await writeFile(htmlPath, html, "utf8");
	let webPng: Buffer;
	try {
		webPng = await screenshotHtmlFileToPng({
			htmlPath,
			width: input.imageWidth,
			height: input.imageHeight,
			playwrightRoots
		});
	} finally {
		await unlink(htmlPath).catch(() => undefined);
	}

	const pageSimilarity = await compareImageBuffers(input.sourceImage, webPng, { threshold });
	return { elementResults, pagePng: webPng, pageHtml: html, pageSimilarity };
}

async function cropBuffer(image: Buffer, bbox: ProxyBBox): Promise<Buffer> {
	const sharpModule = loadSharp();
	return sharpModule(image)
		.extract({
			left: Math.max(0, Math.round(bbox.x)),
			top: Math.max(0, Math.round(bbox.y)),
			width: Math.max(1, Math.round(bbox.w)),
			height: Math.max(1, Math.round(bbox.h))
		})
		.png()
		.toBuffer();
}

type SharpFactory = typeof import("sharp");

function loadSharp(): SharpFactory {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require("sharp") as SharpFactory;
}
