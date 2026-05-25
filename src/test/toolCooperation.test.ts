import test from "node:test";
import assert from "node:assert/strict";
import type { OpenAIMessage, VisionOutputVerbosity } from "../types";
import { buildDisabledVisionMessage, buildFallbackPlan, buildTextFallback } from "../toolCooperation/fallbackPlanner";
import {
	applyDecontaminationToMask,
	applyFeatherToMask,
	applyMorphologyToBinaryMask,
	decontaminateMlSegmentMasks,
	featherMlSegmentMasks,
	refineMlSegmentMasks
} from "../toolCooperation/morphology";
import { needsVision } from "../toolCooperation/needVisionDetector";
import { assembleResult, formatVisionOutput, runProcessingChain } from "../toolCooperation/resultAssembler";
import { evaluateMaskQuality } from "../toolCooperation/maskQuality";
import { applyAnchorDeformationToMask, deformMlSegmentMasks } from "../toolCooperation/deformation";
import { applyBlendToMask, blendMlSegmentMasks } from "../toolCooperation/blending";
import { executeRestorationPipeline, getRestorationPipelineStages } from "../toolCooperation/restorationPipeline";
import { evaluateArtifactScore } from "../toolCooperation/artifactScore";
import { applyStyleConstraintsToSegments, evaluateStyleConsistency } from "../toolCooperation/styleConsistency";
import { fitSvgPathData } from "../toolCooperation/svgPathFitting";
import { evaluateSvgStyleFidelity } from "../toolCooperation/svgStyleFidelity";
import { validateSvgStructure } from "../toolCooperation/svgStructureValidation";
import { validateSvgGeometry } from "../toolCooperation/svgGeometryValidation";
import { decideVectorizationRoute } from "../toolCooperation/vectorizationDecision";
import { selectTool, type ModelCapabilities } from "../toolCooperation/toolSelector";
import type { MlSegmentAdapter } from "../toolCooperation/adapters/types";
import { setMlSegmentAdapterOverrideForTests } from "../toolCooperation/adapters/registry";
import { setSharpAvailabilityForTests } from "../toolCooperation/adapters/sharpAdapter";
import type { VisionBatchResult } from "../visionProtocol/types";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../config/highFidelityRestoreImagePipelineSuspended";

interface SharpMetadataLike {
	width?: number;
	height?: number;
}

interface SharpPipelineLike {
	png(): SharpPipelineLike;
	metadata(): Promise<SharpMetadataLike>;
	toBuffer(): Promise<Buffer>;
}
interface SharpCreateInput {
	create: {
		width: number;
		height: number;
		channels: number;
		background: { r: number; g: number; b: number; alpha?: number };
	};
}

type SharpFactoryLike = (input: Buffer | SharpCreateInput) => SharpPipelineLike;

const sharpModule = require("sharp") as SharpFactoryLike | { default?: SharpFactoryLike };
const resolvedSharpFactory = typeof sharpModule === "function" ? sharpModule : sharpModule.default;

if (!resolvedSharpFactory) {
	throw new Error("sharp test dependency is unavailable");
}

const sharpFactory: SharpFactoryLike = resolvedSharpFactory;

const proxyCaps: ModelCapabilities = {
	modelType: "bro",
	nativeVision: false,
	proxyVision: true,
	wrapperProxyAvailable: false,
	textFallback: true,
	planOnly: true,
	toolCalling: true
};

const sampleMessages: OpenAIMessage[] = [
	{
		role: "user",
		content: [
			{ type: "text", text: "请识别这张 screenshot 里的报错" },
			{ type: "image_url", image_url: { url: "https://example.com/screenshot.png" } }
		]
	}
];

const sampleBatch: VisionBatchResult = {
	batchId: "batch-1",
	sessionId: "session-1",
	totalMs: 42,
	failedRefs: [],
	results: [
		{
			imageRef: "img-1",
			imageHash: "hash-1",
			processingMs: 40,
			objects: [
				{
					id: "obj-1",
					label: "button",
					geometry: {
						version: "v1",
						bbox: { x: 1, y: 2, w: 30, h: 10 },
						rationale: "button-like rectangle"
					},
					rationale: "button-like rectangle",
					attributes: { state: "disabled" }
				}
			]
		}
	]
};

const SAMPLE_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\"> <path d=\"M0 0 H20 V20 H0 Z\"/> </svg>";

async function createSamplePng(width: number, height: number): Promise<Buffer> {
	return sharpFactory({
		create: {
			width,
			height,
			channels: 3,
			background: { r: 255, g: 255, b: 255 }
		}
	})
		.png()
		.toBuffer();
}

async function readDimensions(input: Buffer): Promise<{ width: number; height: number }> {
	const metadata = await sharpFactory(input).metadata();
	return {
		width: metadata.width ?? 0,
		height: metadata.height ?? 0
	};
}

test("needsVision respects needVisionGate and requires actionable image payload", () => {
	assert.equal(needsVision(sampleMessages, proxyCaps, { needVisionGate: true }), true);
	assert.equal(needsVision([
		{ role: "user", content: "just explain the code" }
	], proxyCaps, { needVisionGate: true }), false);
	assert.equal(needsVision([
		{ role: "user", content: "请帮我识图，这张 screenshot 怎么看？" }
	], proxyCaps, { needVisionGate: true }), false);
	assert.equal(needsVision(sampleMessages, proxyCaps, { needVisionGate: false }), false);
});

test("needsVision ignores markdown file paths without image_url parts", () => {
	const docScriptTurn: OpenAIMessage[] = [
		{
			role: "assistant",
			content: [
				{
					type: "text",
					text: "└── 【KOW】M_魔法之塔_assets/\n    ├── image_001.png\n    └── image_002.png"
				}
			]
		},
		{
			role: "user",
			content: "请运行 skill_doc_to_md 脚本重新生成文档，不需要识图。"
		}
	];
	assert.equal(needsVision(docScriptTurn, proxyCaps, { needVisionGate: true }), false);
});

test("selectTool covers proxy, wrapper, native, text fallback, plan-only, and disabled strategies", () => {
	assert.deepEqual(selectTool(true, proxyCaps, { enabled: true }), {
		strategy: "proxy",
		reason: "Bro non-vision models with tools available rely on the proxy route.",
		matrixKey: "bro|non-vision|tools-available|agent-on"
	});
	assert.equal(selectTool(false, proxyCaps, { enabled: true }).strategy, "text-fallback");
	assert.equal(selectTool(true, {
		...proxyCaps,
		modelType: "builtin",
		proxyVision: false,
		wrapperProxyAvailable: true
	}, { enabled: true }).strategy, "wrapper-proxy");
	assert.equal(selectTool(true, {
		...proxyCaps,
		modelType: "builtin",
		proxyVision: false,
		wrapperProxyAvailable: false,
		nativeVision: true
	}, { enabled: true }).strategy, "native");
	assert.equal(selectTool(true, {
		...proxyCaps,
		modelType: "builtin",
		proxyVision: false,
		wrapperProxyAvailable: false,
		textFallback: false
	}, { enabled: false }).strategy, "plan-only");
	assert.equal(selectTool(true, {
		modelType: "builtin",
		nativeVision: false,
		proxyVision: false,
		wrapperProxyAvailable: false,
		textFallback: false,
		planOnly: false,
		toolCalling: false
	}, { enabled: false }).strategy, "disabled");
	assert.equal(selectTool(true, {
		...proxyCaps,
		proxyVision: false,
		nativeVision: true,
		toolCalling: true
	}, { enabled: true }).strategy, "native");
});

test("tool selection matrix covers all six strategies without gray-off proxy leakage", () => {
	const matrix = [
		selectTool(true, proxyCaps, { enabled: true }),
		selectTool(true, { ...proxyCaps, modelType: "builtin", proxyVision: false, wrapperProxyAvailable: true }, { enabled: true }),
		selectTool(true, { ...proxyCaps, modelType: "builtin", proxyVision: false, wrapperProxyAvailable: false, nativeVision: true }, { enabled: true }),
		selectTool(false, proxyCaps, { enabled: true }),
		selectTool(true, { ...proxyCaps, modelType: "builtin", proxyVision: false, wrapperProxyAvailable: false, textFallback: false }, { enabled: false }),
		selectTool(true, { modelType: "builtin", nativeVision: false, proxyVision: false, wrapperProxyAvailable: false, textFallback: false, planOnly: false, toolCalling: false }, { enabled: false })
	].map((selection) => selection.strategy).sort();
	assert.deepEqual(matrix, ["disabled", "native", "plan-only", "proxy", "text-fallback", "wrapper-proxy"].sort());
});

test("resultAssembler emits verbosity-aware outputs", () => {
	const verbosityOutputs = ["conservative", "balanced", "verbose"].map((verbosity) => formatVisionOutput(sampleBatch.results[0], verbosity as VisionOutputVerbosity));
	assert.match(verbosityOutputs[0], /objects=1/);
	assert.doesNotMatch(verbosityOutputs[0], /geometry=/);
	assert.match(verbosityOutputs[1], /reason=button-like rectangle/);
	assert.match(verbosityOutputs[2], /geometry=/);
	assert.match(assembleResult(sampleBatch, sampleMessages, "balanced").at(-1)?.content as string, /vision-batch:batch-1/);
});

test("fallbackPlanner produces executable plan-only and text-fallback messages", () => {
	const planOnly = buildFallbackPlan("vision disabled", [
		{ role: "assistant", content: "intermediate" },
		{ role: "user", content: "summarize the screenshot error" }
	]);
	assert.match(planOnly.content as string, /\[plan-only\]/);
	assert.match(planOnly.content as string, /goal=summarize the screenshot error/);
	assert.match(planOnly.content as string, /steps=1\)/);
	const textFallback = buildTextFallback("proxy unavailable");
	assert.match(textFallback.content as string, /\[text-fallback\]/);
	assert.match(textFallback.content as string, /proxy unavailable/);
	const disabled = buildDisabledVisionMessage("compatibility mode disabled");
	assert.match(disabled.content as string, /\[disabled\]/);
	assert.match(disabled.content as string, /compatibility mode disabled/);
});

test("fallbackPlanner uses a generic review summary when no plain-text user message is available", () => {
	const fromMultipartUser = buildFallbackPlan("vision unavailable", [
		{
			role: "user",
			content: [
				{ type: "text", text: "see screenshot" }
			]
		},
		{ role: "assistant", content: "intermediate" }
	] as OpenAIMessage[]);
	assert.match(fromMultipartUser.content as string, /goal=review the attached visual task/);

	const withoutUser = buildFallbackPlan("vision unavailable", [
		{ role: "assistant", content: "intermediate" }
	]);
	assert.match(withoutUser.content as string, /goal=review the attached visual task/);
});

test("gray switch off never returns proxy or wrapper-proxy", () => {
	assert.notEqual(selectTool(true, proxyCaps, { enabled: false }).strategy, "proxy");
	assert.notEqual(selectTool(true, {
		...proxyCaps,
		modelType: "builtin",
		proxyVision: false,
		wrapperProxyAvailable: true
	}, { enabled: false }).strategy, "wrapper-proxy");
});

test("runProcessingChain preprocesses images and optimizes svg without warnings", async () => {
	const result = await runProcessingChain({
		image: await createSamplePng(40, 40),
		resizeTo: { width: 20, height: 20 },
		svg: SAMPLE_SVG
	}, {
		imagePreprocess: true,
		svgOptimize: true,
		mlSegment: false
	});

	assert.deepEqual(await readDimensions(result.image as Buffer), { width: 20, height: 20 });
	assert.equal(result.svg, "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\"><path d=\"M0 0L20 0L20 20L0 20Z\"/></svg>");
	assert.deepEqual(result.warnings, []);
});

test("runProcessingChain falls back to jimp when sharp is unavailable", async () => {
	try {
		setSharpAvailabilityForTests(false);
		const result = await runProcessingChain({
			image: await createSamplePng(40, 40),
			resizeTo: { width: 20, height: 20 }
		}, {
			imagePreprocess: true,
			svgOptimize: false,
			mlSegment: false,
			rasterVectorize: false
		});

		assert.deepEqual(await readDimensions(result.image as Buffer), { width: 20, height: 20 });
		assert.deepEqual(result.warnings, []);
	} finally {
		setSharpAvailabilityForTests(undefined);
	}
});

test("runProcessingChain records warnings without interrupting later stages", async () => {
	const result = await runProcessingChain({
		image: Buffer.from("not-an-image"),
		resizeTo: { width: 20, height: 20 },
		svg: SAMPLE_SVG
	}, {
		imagePreprocess: true,
		svgOptimize: true,
		mlSegment: true
	});

	assert.match(result.warnings.join("\n"), /imagePreprocess:/);
	assert.equal(result.svg, "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\"><path d=\"M0 0L20 0L20 20L0 20Z\"/></svg>");
	assert.equal(result.mlSegments, undefined);
});

test("E.2 decision engine prefers svg route in auto mode when both svg and raster exist", () => {
	const decision = decideVectorizationRoute({
		hasSvgInput: true,
		hasRasterImage: true,
		svgOptimizeEnabled: true,
		mlSegmentEnabled: true,
		svgDecisionPolicy: "auto",
		rasterPolicy: "auto"
	});

	assert.equal(decision.route, "svg");
	assert.equal(decision.shouldOptimizeSvg, true);
	assert.equal(decision.shouldRunMlSegment, false);
});

test("E.2 runProcessingChain consumes svgDecisionPolicy and rasterPolicy", async () => {
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-e2-policies",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			return [{
				label: "subject",
				mask: Buffer.from([
					0, 255, 0,
					255, 255, 255,
					0, 255, 0
				]),
				confidence: 0.9,
				width: 3,
				height: 3
			}];
		}
	};

	try {
		setMlSegmentAdapterOverrideForTests(segmentationAdapter);

		const preferSvg = await runProcessingChain({
			image: await createSamplePng(24, 24),
			svg: SAMPLE_SVG
		}, {
			imagePreprocess: false,
			svgOptimize: true,
			mlSegment: true,
			svgDecisionPolicy: "auto",
			rasterPolicy: "auto"
		});

		assert.equal(preferSvg.svg, "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\"><path d=\"M0 0L20 0L20 20L0 20Z\"/></svg>");
		assert.equal(preferSvg.mlSegments, undefined);

		const preferRaster = await runProcessingChain({
			image: await createSamplePng(24, 24),
			svg: SAMPLE_SVG
		}, {
			imagePreprocess: false,
			svgOptimize: true,
			mlSegment: true,
			svgDecisionPolicy: "never",
			rasterPolicy: "segment"
		});

		assert.equal(preferRaster.svg, SAMPLE_SVG);
		assert.equal(preferRaster.mlSegments?.length, 1);
	} finally {
		setMlSegmentAdapterOverrideForTests(undefined);
	}
});

test("E.3 path fitting preserves closed topology and corner continuity", () => {
	const fitted = fitSvgPathData("M0 0 L10 0 L10 10 L0 10 Z");

	assert.equal(fitted.closed, true);
	assert.equal(fitted.segmentCount, 4);
	assert.equal(fitted.continuityScore, 1);
	assert.deepEqual(fitted.bbox, { x: 0, y: 0, w: 10, h: 10 });
	assert.deepEqual(fitted.warnings, []);
});

test("E.3 runProcessingChain exposes svgPathFit summary on svg route", async () => {
	const result = await runProcessingChain({
		svg: SAMPLE_SVG
	}, {
		imagePreprocess: false,
		svgOptimize: true,
		mlSegment: false,
		svgDecisionPolicy: "auto",
		rasterPolicy: "auto"
	});

	assert.ok(result.svgPathFit);
	assert.equal(result.svgPathFit?.pathCount, 1);
	assert.equal(result.svgPathFit?.closedPathCount, 1);
	assert.equal(result.svgPathFit?.aggregateContinuityScore, 1);
	assert.equal(result.svgPathFit?.warnings.length, 0);
	assert.match(result.svg as string, /<path d="M0 0L20 0L20 20L0 20Z"\/>/);
});

test("E.4 svg style fidelity preserves style-bearing attributes through svg route", async () => {
	const styleSvg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 12 12\"><path d=\"M0 0 L12 0 L12 12 L0 12 Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" opacity=\"0.8\"/></svg>";
	const fidelity = evaluateSvgStyleFidelity(styleSvg, styleSvg);
	assert.equal(fidelity.sourceTokenCount, 4);
	assert.equal(fidelity.preservedTokenCount, 4);
	assert.equal(fidelity.fidelityScore, 1);
	assert.deepEqual(fidelity.warnings, []);

	const result = await runProcessingChain({
		svg: styleSvg
	}, {
		imagePreprocess: false,
		svgOptimize: true,
		mlSegment: false,
		svgDecisionPolicy: "auto",
		rasterPolicy: "auto"
	});

	assert.ok(result.svgStyleFidelity);
	assert.equal(result.svgStyleFidelity?.sourceTokenCount, 4);
	assert.equal(result.svgStyleFidelity?.preservedTokenCount, 4);
	assert.equal(result.svgStyleFidelity?.fidelityScore, 1);
	assert.equal(result.svgStyleFidelity?.warnings.length, 0);
});

test("E.5 svg structure validation distinguishes legal and malformed svg", () => {
	const validStructure = validateSvgStructure(SAMPLE_SVG);
	const invalidStructure = validateSvgStructure("<svg><path d=\"M0 0L1 1Z\"/></svg>");

	assert.equal(validStructure.valid, true);
	assert.equal(validStructure.pathCount, 1);
	assert.deepEqual(validStructure.warnings, []);
	assert.equal(invalidStructure.valid, false);
	assert.ok(invalidStructure.warnings.includes("svgStructure:missing_viewBox"));
});

test("E.5 runProcessingChain exposes svgStructureValidation summary on svg route", async () => {
	const result = await runProcessingChain({
		svg: SAMPLE_SVG
	}, {
		imagePreprocess: false,
		svgOptimize: true,
		mlSegment: false,
		svgDecisionPolicy: "auto",
		rasterPolicy: "auto"
	});

	assert.ok(result.svgStructureValidation);
	assert.equal(result.svgStructureValidation?.valid, true);
	assert.equal(result.svgStructureValidation?.pathCount, 1);
	assert.equal(result.svgStructureValidation?.warnings.length, 0);
});

test("E.6 svg geometry validation flags paths outside the viewBox", () => {
	const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><path d=\"M0 0 L20 0 L20 20 Z\"/></svg>";
	const fitted = fitSvgPathData("M0 0 L20 0 L20 20 Z");
	const geometry = validateSvgGeometry(svg, { pathCount: 1, closedPathCount: 1, aggregateContinuityScore: 1, warnings: [], paths: [fitted] });

	assert.equal(geometry.withinViewBox, false);
	assert.deepEqual(geometry.violatingPathIndexes, [0]);
	assert.ok(geometry.warnings.some((warning) => warning.startsWith("svgGeometry:paths_outside_viewBox=")));
});

test("E.6 runProcessingChain exposes svgGeometryValidation summary on svg route", async () => {
	const result = await runProcessingChain({
		svg: SAMPLE_SVG
	}, {
		imagePreprocess: false,
		svgOptimize: true,
		mlSegment: false,
		svgDecisionPolicy: "auto",
		rasterPolicy: "auto"
	});

	assert.ok(result.svgGeometryValidation);
	assert.equal(result.svgGeometryValidation?.withinViewBox, true);
	assert.equal(result.svgGeometryValidation?.violatingPathIndexes.length, 0);
	assert.equal(result.svgGeometryValidation?.warnings.length, 0);
});

test("E.7 unit pack: decision + path fitting + structure validation stay deterministic", () => {
	const decision = decideVectorizationRoute({
		hasSvgInput: true,
		hasRasterImage: true,
		svgOptimizeEnabled: true,
		mlSegmentEnabled: true,
		svgDecisionPolicy: "auto",
		rasterPolicy: "auto"
	});
	assert.equal(decision.route, "svg");
	assert.equal(decision.shouldRunMlSegment, false);

	const fitted = fitSvgPathData("M0 0 L20 0 L20 20 L0 20 Z");
	assert.equal(fitted.closed, true);
	assert.equal(fitted.segmentCount, 4);
	assert.equal(fitted.continuityScore, 1);

	const normalizedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="${fitted.fittedPath}"/></svg>`;
	const structure = validateSvgStructure(normalizedSvg);
	assert.equal(structure.valid, true);
	assert.equal(structure.pathCount, 1);
	assert.deepEqual(structure.warnings, []);
});

test("E.8 integration: svg route and raster mask route switch coherently under policy", async () => {
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-e8-integration",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			return [{
				label: "subject",
				mask: Buffer.from([
					0, 255, 0,
					255, 255, 255,
					0, 255, 0
				]),
				confidence: 0.92,
				width: 3,
				height: 3
			}];
		}
	};

	try {
		setMlSegmentAdapterOverrideForTests(segmentationAdapter);
		const inputImage = await createSamplePng(24, 24);

		const svgRoute = await runProcessingChain({
			image: inputImage,
			svg: SAMPLE_SVG,
			deformation: {
				mode: "affine",
				anchors: [
					{ x: 0, y: 0, dx: 1, dy: 0 },
					{ x: 2, y: 0, dx: 0, dy: 1 },
					{ x: 0, y: 2, dx: 1, dy: 1 }
				],
				constraints: { maxDisplacement: 1, clampToBounds: true }
			},
			blend: { mode: "multi-band", strength: 1 },
			style: { textureConsistency: 0.8, edgeConsistency: 0.8, toneConsistency: 0.8, warningThreshold: 0.5 },
			artifact: { threshold: 1 }
		}, {
			imagePreprocess: false,
			svgOptimize: true,
			mlSegment: true,
			svgDecisionPolicy: "auto",
			rasterPolicy: "auto"
		});

		assert.ok(svgRoute.svgPathFit);
		assert.ok(svgRoute.svgStructureValidation);
		assert.ok(svgRoute.svgGeometryValidation);
		assert.equal(svgRoute.mlSegments, undefined);
		assert.equal(svgRoute.maskQuality, undefined);

		const rasterRoute = await runProcessingChain({
			image: inputImage,
			svg: SAMPLE_SVG,
			deformation: {
				mode: "affine",
				anchors: [
					{ x: 0, y: 0, dx: 1, dy: 0 },
					{ x: 2, y: 0, dx: 0, dy: 1 },
					{ x: 0, y: 2, dx: 1, dy: 1 }
				],
				constraints: { maxDisplacement: 1, clampToBounds: true }
			},
			blend: { mode: "multi-band", strength: 1 },
			style: { textureConsistency: 0.8, edgeConsistency: 0.8, toneConsistency: 0.8, warningThreshold: 0.5 },
			artifact: { threshold: 1 }
		}, {
			imagePreprocess: false,
			svgOptimize: true,
			mlSegment: true,
			svgDecisionPolicy: "never",
			rasterPolicy: "segment"
		});

		assert.equal(rasterRoute.svg, SAMPLE_SVG);
		assert.equal(rasterRoute.svgPathFit, undefined);
		assert.ok(rasterRoute.mlSegments);
		assert.ok(rasterRoute.maskQuality);
		assert.ok(rasterRoute.styleConsistency);
		assert.ok(rasterRoute.artifactScore);
	} finally {
		setMlSegmentAdapterOverrideForTests(undefined);
	}
});

test("E.9 cross-check: decision, svg artifacts, and geometry report stay consistent", async () => {
	const decision = decideVectorizationRoute({
		hasSvgInput: true,
		hasRasterImage: true,
		svgOptimizeEnabled: true,
		mlSegmentEnabled: true,
		svgDecisionPolicy: "auto",
		rasterPolicy: "auto"
	});
	assert.equal(decision.route, "svg");

	const result = await runProcessingChain({
		image: await createSamplePng(24, 24),
		svg: SAMPLE_SVG
	}, {
		imagePreprocess: false,
		svgOptimize: true,
		mlSegment: true,
		svgDecisionPolicy: "auto",
		rasterPolicy: "auto"
	});

	assert.ok(result.svgPathFit);
	assert.ok(result.svgStructureValidation);
	assert.ok(result.svgGeometryValidation);
	assert.equal(result.svgPathFit?.pathCount, result.svgStructureValidation?.pathCount);
	assert.equal(result.svgGeometryValidation?.withinViewBox, true);
	assert.equal(result.svgGeometryValidation?.violatingPathIndexes.length, 0);
	assert.equal(result.warnings.some((warning) => warning.startsWith("svgGeometry:")), false);
});

test("restoration pipeline keeps deterministic stage order for C.2", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	assert.deepEqual(getRestorationPipelineStages(), [
		"segmentation",
		"mask-refine",
		"edge-cleanup",
		"anti-halo",
		"alpha-consistency"
	]);
});

test("restoration pipeline warns when segmentation adapter is unavailable", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const result = await executeRestorationPipeline({
		image: Buffer.from([1, 2, 3]),
		mlSegmentAdapter: null
	});

	assert.equal(result.mlSegments, undefined);
	assert.ok(result.warnings.includes("restoration:segmentation_adapter_unavailable"));
});

test("C.3 morphology opening removes isolated noise in binary mask", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const width = 5;
	const height = 5;
	const sparseNoise = Buffer.from([
		0, 0, 0, 0, 0,
		0, 255, 0, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 0, 255, 0,
		0, 0, 0, 0, 0
	]);

	const refined = applyMorphologyToBinaryMask(sparseNoise, width, height, {
		mode: "open",
		radius: 1,
		threshold: 127
	});

	assert.deepEqual(Array.from(refined), new Array(width * height).fill(0));
});

test("C.3 restoration pipeline applies mask-refine morphology with configurable radius", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const rawMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 0, 255, 0, 0,
		0, 255, 255, 255, 0,
		0, 0, 255, 0, 0,
		0, 0, 0, 0, 0
	]);
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer): Promise<Array<{ label: string; mask: Buffer; confidence: number; width: number; height: number }>> {
			return [{
				label: "target",
				mask: Buffer.from(rawMask),
				confidence: 0.95,
				width: 5,
				height: 5
			}];
		}
	};

	const result = await executeRestorationPipeline({
		image: Buffer.from([9, 9, 9]),
		mlSegmentAdapter: segmentationAdapter,
		maskRefine: {
			mode: "open",
			radius: 1,
			threshold: 127
		}
	});

	assert.equal(result.warnings.length, 0);
	assert.equal(result.mlSegments?.length, 1);
	assert.notDeepEqual(Array.from(result.mlSegments?.[0]?.mask ?? Buffer.alloc(0)), Array.from(rawMask));
});

test("C.4 feather smooths hard mask edges with configurable radius", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const width = 5;
	const height = 5;
	const hardMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 255, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0
	]);

	const feathered = applyFeatherToMask(hardMask, width, height, { radius: 1 });

	assert.ok(feathered[2 * width + 2] < 255);
	assert.ok(feathered[2 * width + 2] > 0);
	assert.ok(feathered[2 * width + 1] > 0);
	assert.ok(feathered[1 * width + 2] > 0);
});

test("C.4 restoration pipeline applies edge-cleanup feather after mask-refine", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const rawMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 255, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0
	]);
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-feather",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			return [{
				label: "target",
				mask: Buffer.from(rawMask),
				confidence: 0.9,
				width: 5,
				height: 5
			}];
		}
	};

	const result = await executeRestorationPipeline({
		image: Buffer.from([9, 9, 9]),
		mlSegmentAdapter: segmentationAdapter,
		maskRefine: {
			mode: "close",
			radius: 0,
			threshold: 127
		},
		edgeCleanup: {
			featherRadius: 1
		}
	});

	assert.equal(result.warnings.length, 0);
	assert.equal(result.mlSegments?.length, 1);
	assert.notDeepEqual(Array.from(result.mlSegments?.[0]?.mask ?? Buffer.alloc(0)), Array.from(rawMask));
});

test("C.5 decontamination suppresses semi-transparent halo contamination", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const width = 5;
	const height = 5;
	const contaminatedMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 40, 90, 40, 0,
		0, 90, 255, 90, 0,
		0, 40, 90, 40, 0,
		0, 0, 0, 0, 0
	]);

	const cleaned = applyDecontaminationToMask(contaminatedMask, width, height, {
		threshold: 127,
		strength: 1
	});

	assert.equal(cleaned[2 * width + 2], 255);
	assert.ok(cleaned[1 * width + 2] < contaminatedMask[1 * width + 2]);
	assert.ok(cleaned[2 * width + 1] < contaminatedMask[2 * width + 1]);
});

test("C.5 restoration pipeline applies anti-halo decontamination", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const rawMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 40, 90, 40, 0,
		0, 90, 255, 90, 0,
		0, 40, 90, 40, 0,
		0, 0, 0, 0, 0
	]);
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-decontam",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			return [{
				label: "target",
				mask: Buffer.from(rawMask),
				confidence: 0.88,
				width: 5,
				height: 5
			}];
		}
	};

	const result = await executeRestorationPipeline({
		image: Buffer.from([7, 7, 7]),
		mlSegmentAdapter: segmentationAdapter,
		maskRefine: {
			mode: "close",
			radius: 0,
			threshold: 127
		},
		edgeCleanup: {
			featherRadius: 0
		},
		antiHalo: {
			threshold: 127,
			strength: 1
		}
	});

	assert.equal(result.warnings.length, 0);
	assert.equal(result.mlSegments?.length, 1);
	const cleaned = result.mlSegments?.[0]?.mask ?? Buffer.alloc(0);
	assert.ok(cleaned[1 * 5 + 2] < rawMask[1 * 5 + 2]);
	assert.ok(cleaned[2 * 5 + 1] < rawMask[2 * 5 + 1]);
});

test("C.6 mask quality surrogate scores penalize noisy boundaries", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const compactMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 255, 255, 255, 0,
		0, 255, 255, 255, 0,
		0, 255, 255, 255, 0,
		0, 0, 0, 0, 0
	]);
	const noisyMask = Buffer.from([
		0, 255, 0, 255, 0,
		255, 0, 255, 0, 255,
		0, 255, 0, 255, 0,
		255, 0, 255, 0, 255,
		0, 255, 0, 255, 0
	]);

	const compact = evaluateMaskQuality([{ label: "compact", confidence: 0.9, mask: compactMask, width: 5, height: 5 }]);
	const noisy = evaluateMaskQuality([{ label: "noisy", confidence: 0.9, mask: noisyMask, width: 5, height: 5 }]);

	assert.ok(compact.aggregate.iouSurrogate > noisy.aggregate.iouSurrogate);
	assert.ok(compact.aggregate.boundaryFSurrogate > noisy.aggregate.boundaryFSurrogate);
});

test("C.6 restoration pipeline emits alpha-consistency mask quality metrics", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const rawMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 0, 255, 0, 0,
		0, 255, 255, 255, 0,
		0, 0, 255, 0, 0,
		0, 0, 0, 0, 0
	]);
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-quality",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			return [{
				label: "target",
				mask: Buffer.from(rawMask),
				confidence: 0.91,
				width: 5,
				height: 5
			}];
		}
	};

	const result = await executeRestorationPipeline({
		image: Buffer.from([5, 5, 5]),
		mlSegmentAdapter: segmentationAdapter,
		maskRefine: {
			mode: "close",
			radius: 0,
			threshold: 127
		},
		edgeCleanup: {
			featherRadius: 0
		},
		antiHalo: {
			threshold: 127,
			strength: 0
		}
	});

	assert.equal(result.warnings.some((warning) => warning.startsWith("restoration:")), false);
	assert.ok(result.maskQuality);
	assert.equal(result.maskQuality?.perSegment.length, 1);
	assert.ok((result.maskQuality?.aggregate.iouSurrogate ?? 0) > 0);
	assert.ok((result.maskQuality?.aggregate.boundaryFSurrogate ?? 0) > 0);
});

test("C.7 restoration pipeline emits warning and fallback when segmentation stage throws", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-throw",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			throw new Error("segmentation boom");
		}
	};

	const result = await executeRestorationPipeline({
		image: Buffer.from([3, 3, 3]),
		mlSegmentAdapter: segmentationAdapter
	});

	assert.equal(result.mlSegments, undefined);
	assert.equal(result.maskQuality, undefined);
	assert.ok(result.warnings.some((warning) => warning.includes("restoration:segmentation:segmentation boom")));
});

test("C.7 restoration pipeline rolls back to previous stage output when mask-refine throws", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const rawMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 0, 255, 0, 0,
		0, 255, 255, 255, 0,
		0, 0, 255, 0, 0,
		0, 0, 0, 0, 0
	]);
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-fallback",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			return [{
				label: "target",
				mask: Buffer.from(rawMask),
				confidence: 0.9,
				width: 5,
				height: 5
			}];
		}
	};
	const brokenMaskRefine = {
		get mode() {
			throw new Error("bad mask refine config");
		},
		radius: 1,
		threshold: 127
	} as unknown as { mode: "open"; radius: number; threshold: number };

	const result = await executeRestorationPipeline({
		image: Buffer.from([4, 4, 4]),
		mlSegmentAdapter: segmentationAdapter,
		maskRefine: brokenMaskRefine
	});

	assert.equal(result.mlSegments?.length, 1);
	assert.deepEqual(Array.from(result.mlSegments?.[0]?.mask ?? Buffer.alloc(0)), Array.from(rawMask));
	assert.equal(result.maskQuality, undefined);
	assert.ok(result.warnings.some((warning) => warning.includes("restoration:mask-refine:bad mask refine config")));
});

test("C.8 branch: C.3/C.4/C.5 segment helpers warn and keep segment on invalid geometry", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const invalid = [{ label: "bad", confidence: 0.5, mask: Buffer.from([0, 255, 0, 255, 0, 255]), width: 0, height: 0 }];

	const morph = refineMlSegmentMasks(invalid, { mode: "open", radius: 1, threshold: 127 });
	const feather = featherMlSegmentMasks(invalid, { radius: 1 });
	const decontam = decontaminateMlSegmentMasks(invalid, { threshold: 127, strength: 1 });

	assert.ok(morph.warnings.includes("morphology:segment_0_invalid_mask_geometry"));
	assert.ok(feather.warnings.includes("feather:segment_0_invalid_mask_geometry"));
	assert.ok(decontam.warnings.includes("decontaminate:segment_0_invalid_mask_geometry"));
	assert.equal(morph.segments[0], invalid[0]);
	assert.equal(feather.segments[0], invalid[0]);
	assert.equal(decontam.segments[0], invalid[0]);
});

test("C.8 branch: feather/decontaminate identity path on zero radius or zero strength", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const mask = Buffer.from([
		0, 0, 0,
		0, 180, 0,
		0, 0, 0
	]);

	const noFeather = applyFeatherToMask(mask, 3, 3, { radius: 0 });
	const noDecontam = applyDecontaminationToMask(mask, 3, 3, { threshold: 127, strength: 0 });

	assert.deepEqual(Array.from(noFeather), Array.from(mask));
	assert.deepEqual(Array.from(noDecontam), Array.from(mask));
	assert.notEqual(noFeather, mask);
	assert.notEqual(noDecontam, mask);
});

test("C.8 branch: decontamination clamps strength into [0,1]", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const mask = Buffer.from([
		0, 0, 0,
		0, 120, 255,
		0, 0, 0
	]);

	const clampedHigh = applyDecontaminationToMask(mask, 3, 3, { threshold: 127, strength: 999 });
	const explicitOne = applyDecontaminationToMask(mask, 3, 3, { threshold: 127, strength: 1 });

	assert.deepEqual(Array.from(clampedHigh), Array.from(explicitOne));
});

test("C.8 branch: mask quality warns on invalid geometry and keeps aggregate at zero", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const quality = evaluateMaskQuality([
		{ label: "bad", confidence: 0.2, mask: Buffer.from([0, 255, 0, 255, 0, 255]), width: 0, height: 0 }
	]);

	assert.equal(quality.perSegment.length, 0);
	assert.equal(quality.aggregate.iouSurrogate, 0);
	assert.equal(quality.aggregate.boundaryFSurrogate, 0);
	assert.ok(quality.warnings.includes("quality:segment_0_invalid_mask_geometry"));
});

test("C.10 cross-check: warnings, maskQuality, and final image-change status stay consistent", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const original = Buffer.from("not-an-image");
	const result = await runProcessingChain({ image: Buffer.from(original) }, {
		imagePreprocess: true,
		svgOptimize: false,
		mlSegment: true
	});

	assert.ok(result.warnings.length > 0);
	assert.equal(result.maskQuality, undefined);
	assert.deepEqual(Array.from(result.image ?? Buffer.alloc(0)), Array.from(original));
});

test("D.2 affine anchor deformation clamps displacement by constraints", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const mask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 255, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0
	]);

	const deformed = applyAnchorDeformationToMask(mask, 5, 5, {
		mode: "affine",
		anchors: [
			{ x: 0, y: 0, dx: 4, dy: 0 },
			{ x: 4, y: 0, dx: 4, dy: 0 },
			{ x: 0, y: 4, dx: 4, dy: 0 }
		],
		constraints: {
			maxDisplacement: 1,
			clampToBounds: true
		}
	});

	assert.equal(deformed[2 * 5 + 3], 255);
	assert.notDeepEqual(Array.from(deformed), Array.from(mask));
});

test("D.2 deformation warns and keeps segment when perspective anchors are insufficient", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const segment = [{
		label: "target",
		confidence: 0.7,
		mask: Buffer.from([
			0, 0, 0, 0,
			0, 255, 0, 0,
			0, 0, 0, 0,
			0, 0, 0, 0
		]),
		width: 4,
		height: 4
	}];

	const result = deformMlSegmentMasks(segment, {
		mode: "perspective",
		anchors: [
			{ x: 0, y: 0, dx: 1, dy: 0 },
			{ x: 3, y: 0, dx: 1, dy: 0 },
			{ x: 0, y: 3, dx: 1, dy: 0 }
		],
		constraints: { maxDisplacement: 2 }
	});

	assert.ok(result.warnings.some((warning) => warning.includes("insufficient_anchors_for_perspective")));
	assert.deepEqual(Array.from(result.segments[0].mask), Array.from(segment[0].mask));
});

test("D.2 restoration pipeline applies deformation with controllable anchors", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const rawMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 255, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0
	]);
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-deform",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			return [{
				label: "target",
				mask: Buffer.from(rawMask),
				confidence: 0.9,
				width: 5,
				height: 5
			}];
		}
	};

	const result = await executeRestorationPipeline({
		image: Buffer.from([9, 8, 7]),
		mlSegmentAdapter: segmentationAdapter,
		maskRefine: { mode: "close", radius: 0, threshold: 127 },
		edgeCleanup: { featherRadius: 0 },
		antiHalo: { threshold: 127, strength: 0 },
		deformation: {
			mode: "affine",
			anchors: [
				{ x: 0, y: 0, dx: 1, dy: 0 },
				{ x: 4, y: 0, dx: 1, dy: 0 },
				{ x: 0, y: 4, dx: 1, dy: 0 }
			],
			constraints: {
				maxDisplacement: 1,
				clampToBounds: true
			}
		}
	});

	assert.equal(result.warnings.some((warning) => warning.startsWith("restoration:")), false);
	assert.equal(result.mlSegments?.length, 1);
	assert.notDeepEqual(Array.from(result.mlSegments?.[0]?.mask ?? Buffer.alloc(0)), Array.from(rawMask));
	assert.ok((result.maskQuality?.aggregate.iouSurrogate ?? 0) > 0);
});

test("D.3 multi-band blend smooths hard alpha transitions", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const mask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 255, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0
	]);

	const blended = applyBlendToMask(mask, 5, 5, {
		mode: "multi-band",
		strength: 1
	});

	assert.ok(blended[2 * 5 + 2] < 255);
	assert.ok(blended[2 * 5 + 1] > 0);
	assert.ok(blended[1 * 5 + 2] > 0);
});

test("D.3 blend falls back from poisson-like to multi-band when iterations are invalid", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const segment = [{
		label: "target",
		confidence: 0.8,
		mask: Buffer.from([
			0, 0, 0, 0, 0,
			0, 0, 0, 0, 0,
			0, 0, 255, 0, 0,
			0, 0, 0, 0, 0,
			0, 0, 0, 0, 0
		]),
		width: 5,
		height: 5
	}];

	const poissonInvalid = blendMlSegmentMasks(segment, {
		mode: "poisson-like",
		strength: 1,
		iterations: 0,
		fallbackMode: "multi-band"
	});
	const multibandDirect = blendMlSegmentMasks(segment, {
		mode: "multi-band",
		strength: 1
	});

	assert.equal(poissonInvalid.warnings.length, 0);
	assert.deepEqual(Array.from(poissonInvalid.segments[0].mask), Array.from(multibandDirect.segments[0].mask));
});

test("D.3 restoration pipeline applies blend strategy after deformation", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const rawMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 255, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0
	]);
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-blend",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			return [{
				label: "target",
				mask: Buffer.from(rawMask),
				confidence: 0.9,
				width: 5,
				height: 5
			}];
		}
	};

	const result = await executeRestorationPipeline({
		image: Buffer.from([7, 7, 7]),
		mlSegmentAdapter: segmentationAdapter,
		maskRefine: { mode: "close", radius: 0, threshold: 127 },
		edgeCleanup: { featherRadius: 0 },
		antiHalo: { threshold: 127, strength: 0 },
		deformation: {
			mode: "grid",
			anchors: [{ x: 2, y: 2, dx: 1, dy: 0 }],
			constraints: { maxDisplacement: 1, clampToBounds: true }
		},
		blend: {
			mode: "multi-band",
			strength: 1
		}
	});

	assert.equal(result.warnings.length, 0);
	assert.equal(result.mlSegments?.length, 1);
	assert.notDeepEqual(Array.from(result.mlSegments?.[0]?.mask ?? Buffer.alloc(0)), Array.from(rawMask));
	assert.ok(result.maskQuality);
	assert.equal(result.maskQuality?.perSegment.length, 1);
	assert.ok((result.maskQuality?.aggregate.boundaryFSurrogate ?? 0) >= 0);
});

test("D.4 artifact score is higher for noisy boundary masks than compact masks", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const compactMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 255, 255, 255, 0,
		0, 255, 255, 255, 0,
		0, 255, 255, 255, 0,
		0, 0, 0, 0, 0
	]);
	const noisyMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 128, 128, 128, 0,
		0, 128, 128, 128, 0,
		0, 128, 128, 128, 0,
		0, 0, 0, 0, 0
	]);

	const compact = evaluateArtifactScore([{ label: "compact", confidence: 0.9, mask: compactMask, width: 5, height: 5 }], 0.5);
	const noisy = evaluateArtifactScore([{ label: "noisy", confidence: 0.9, mask: noisyMask, width: 5, height: 5 }], 0.5);

	assert.ok(noisy.perSegment[0].transitionRatio > compact.perSegment[0].transitionRatio);
	assert.ok(noisy.aggregateScore > compact.aggregateScore);
	assert.equal(noisy.perSegment.length, 1);
});

test("D.4 restoration pipeline emits artifact threshold warning when exceeded", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const noisyMask = Buffer.from([
		0, 255, 0, 255, 0,
		255, 128, 255, 128, 255,
		0, 255, 0, 255, 0,
		255, 128, 255, 128, 255,
		0, 255, 0, 255, 0
	]);
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-artifact",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			return [{
				label: "target",
				mask: Buffer.from(noisyMask),
				confidence: 0.86,
				width: 5,
				height: 5
			}];
		}
	};

	const result = await executeRestorationPipeline({
		image: Buffer.from([3, 2, 1]),
		mlSegmentAdapter: segmentationAdapter,
		maskRefine: {
			mode: "close",
			radius: 0,
			threshold: 127
		},
		edgeCleanup: {
			featherRadius: 0
		},
		antiHalo: {
			threshold: 127,
			strength: 0
		},
		artifact: {
			threshold: 0
		}
	});

	assert.ok(result.artifactScore);
	assert.equal(result.artifactScore?.exceeded, true);
	assert.ok(result.warnings.some((warning) => warning.startsWith("artifact:score_above_threshold:")));
});

test("D.4 runProcessingChain exposes artifact score output", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const result = await runProcessingChain({
		image: Buffer.from("not-an-image"),
		artifact: {
			threshold: 0.1
		}
	}, {
		imagePreprocess: true,
		svgOptimize: false,
		mlSegment: true
	});

	assert.ok(Array.isArray(result.warnings));
	assert.equal(result.artifactScore, undefined);
});

test("D.5 style consistency scoring improves after applying strong constraints", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const referenceMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 128, 128, 128, 0,
		0, 128, 255, 128, 0,
		0, 128, 128, 128, 0,
		0, 0, 0, 0, 0
	]);
	const degradedMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 255, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0
	]);

	const baseline = evaluateStyleConsistency([
		{ label: "target", confidence: 0.9, mask: referenceMask, width: 5, height: 5 }
	], [
		{ label: "target", confidence: 0.9, mask: degradedMask, width: 5, height: 5 }
	]);

	const constrained = applyStyleConstraintsToSegments([
		{ label: "target", confidence: 0.9, mask: referenceMask, width: 5, height: 5 }
	], [
		{ label: "target", confidence: 0.9, mask: degradedMask, width: 5, height: 5 }
	], {
		textureConsistency: 1,
		edgeConsistency: 1,
		toneConsistency: 1,
		warningThreshold: 0.8
	}).segments[0].mask;
	const improved = evaluateStyleConsistency([
		{ label: "target", confidence: 0.9, mask: referenceMask, width: 5, height: 5 }
	], [
		{ label: "target", confidence: 0.9, mask: constrained, width: 5, height: 5 }
	]);

	assert.ok(improved.aggregateScore > baseline.aggregateScore);
	assert.ok(improved.perSegment[0].toneDelta < baseline.perSegment[0].toneDelta);
});

test("D.5 restoration pipeline style constraints preserve consistency after deformation and blend", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const rawMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 128, 255, 128, 0,
		0, 255, 255, 255, 0,
		0, 128, 255, 128, 0,
		0, 0, 0, 0, 0
	]);
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-style",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			return [{
				label: "target",
				mask: Buffer.from(rawMask),
				confidence: 0.9,
				width: 5,
				height: 5
			}];
		}
	};

	const withoutStyle = await executeRestorationPipeline({
		image: Buffer.from([9, 9, 9]),
		mlSegmentAdapter: segmentationAdapter,
		maskRefine: { mode: "close", radius: 0, threshold: 127 },
		edgeCleanup: { featherRadius: 0 },
		antiHalo: { threshold: 127, strength: 0 },
		deformation: {
			mode: "affine",
			anchors: [
				{ x: 0, y: 0, dx: 1, dy: 0 },
				{ x: 4, y: 0, dx: 1, dy: 0 },
				{ x: 0, y: 4, dx: 1, dy: 0 }
			],
			constraints: { maxDisplacement: 1, clampToBounds: true }
		},
		blend: {
			mode: "multi-band",
			strength: 1
		}
	});

	const withStyle = await executeRestorationPipeline({
		image: Buffer.from([9, 9, 9]),
		mlSegmentAdapter: segmentationAdapter,
		maskRefine: { mode: "close", radius: 0, threshold: 127 },
		edgeCleanup: { featherRadius: 0 },
		antiHalo: { threshold: 127, strength: 0 },
		deformation: {
			mode: "affine",
			anchors: [
				{ x: 0, y: 0, dx: 1, dy: 0 },
				{ x: 4, y: 0, dx: 1, dy: 0 },
				{ x: 0, y: 4, dx: 1, dy: 0 }
			],
			constraints: { maxDisplacement: 1, clampToBounds: true }
		},
		blend: {
			mode: "multi-band",
			strength: 1
		},
		style: {
			textureConsistency: 1,
			edgeConsistency: 1,
			toneConsistency: 1,
			warningThreshold: 0.8
		}
	});

	const withoutScore = evaluateStyleConsistency([
		{ label: "target", confidence: 0.9, mask: rawMask, width: 5, height: 5 }
	], [
		{ label: "target", confidence: 0.9, mask: withoutStyle.mlSegments?.[0]?.mask ?? Buffer.alloc(25), width: 5, height: 5 }
	]).aggregateScore;
	const withScore = evaluateStyleConsistency([
		{ label: "target", confidence: 0.9, mask: rawMask, width: 5, height: 5 }
	], [
		{ label: "target", confidence: 0.9, mask: withStyle.mlSegments?.[0]?.mask ?? Buffer.alloc(25), width: 5, height: 5 }
	]).aggregateScore;

	assert.ok(withStyle.styleConsistency);
	assert.ok((withStyle.styleConsistency?.aggregateScore ?? 0) > 0);
	assert.ok(withScore > withoutScore);
});

test("D.6 style consistency is identity when reference equals candidate", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const mask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 128, 128, 128, 0,
		0, 128, 255, 128, 0,
		0, 128, 128, 128, 0,
		0, 0, 0, 0, 0
	]);

	const summary = evaluateStyleConsistency([
		{ label: "target", confidence: 0.9, mask, width: 5, height: 5 }
	], [
		{ label: "target", confidence: 0.9, mask: Buffer.from(mask), width: 5, height: 5 }
	]);

	assert.equal(summary.perSegment.length, 1);
	assert.equal(summary.perSegment[0].textureDelta, 0);
	assert.equal(summary.perSegment[0].edgeDelta, 0);
	assert.equal(summary.perSegment[0].toneDelta, 0);
	assert.equal(summary.aggregateScore, 1);
	assert.equal(summary.belowThreshold, false);
});

test("D.6 style consistency clamps threshold into [0,1]", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const mask = Buffer.from([
		0, 0, 0, 0,
		0, 255, 255, 0,
		0, 255, 255, 0,
		0, 0, 0, 0
	]);
	const degraded = Buffer.from([
		0, 0, 0, 0,
		0, 0, 255, 0,
		0, 255, 0, 0,
		0, 0, 0, 0
	]);

	const low = evaluateStyleConsistency([
		{ label: "target", confidence: 0.8, mask, width: 4, height: 4 }
	], [
		{ label: "target", confidence: 0.8, mask: degraded, width: 4, height: 4 }
	], -10);
	const high = evaluateStyleConsistency([
		{ label: "target", confidence: 0.8, mask, width: 4, height: 4 }
	], [
		{ label: "target", confidence: 0.8, mask: degraded, width: 4, height: 4 }
	], 10);

	assert.equal(low.threshold, 0);
	assert.equal(low.belowThreshold, false);
	assert.equal(high.threshold, 1);
	assert.equal(high.belowThreshold, true);
});

test("D.6 style constraints clamp out-of-range options and improve degraded mask", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const referenceMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 128, 128, 128, 0,
		0, 128, 255, 128, 0,
		0, 128, 128, 128, 0,
		0, 0, 0, 0, 0
	]);
	const degradedMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 255, 0, 0,
		0, 0, 0, 0, 0,
		0, 0, 0, 0, 0
	]);

	const baseline = evaluateStyleConsistency([
		{ label: "target", confidence: 0.9, mask: referenceMask, width: 5, height: 5 }
	], [
		{ label: "target", confidence: 0.9, mask: degradedMask, width: 5, height: 5 }
	]).aggregateScore;

	const constrained = applyStyleConstraintsToSegments([
		{ label: "target", confidence: 0.9, mask: referenceMask, width: 5, height: 5 }
	], [
		{ label: "target", confidence: 0.9, mask: degradedMask, width: 5, height: 5 }
	], {
		textureConsistency: 999,
		edgeConsistency: -999,
		toneConsistency: 2,
		warningThreshold: -1
	});

	const improved = evaluateStyleConsistency([
		{ label: "target", confidence: 0.9, mask: referenceMask, width: 5, height: 5 }
	], [
		{ label: "target", confidence: 0.9, mask: constrained.segments[0].mask, width: 5, height: 5 }
	]);

	assert.equal(constrained.styleConsistency.threshold, 0);
	assert.ok(improved.aggregateScore > baseline);
});

test("D.6 style constraints emit warnings for geometry mismatch and missing reference", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, () => {
	const result = applyStyleConstraintsToSegments([
		{ label: "ref", confidence: 0.9, mask: Buffer.from([0, 255, 255, 0]), width: 2, height: 2 }
	], [
		{ label: "mismatch", confidence: 0.8, mask: Buffer.from([0, 0, 255, 0, 0, 0, 255, 0, 0]), width: 3, height: 3 },
		{ label: "extra", confidence: 0.7, mask: Buffer.from([0, 255, 0, 255]), width: 2, height: 2 }
	]);

	assert.ok(result.warnings.some((warning) => warning.includes("style:segment_0_geometry_mismatch")));
	assert.ok(result.warnings.some((warning) => warning.includes("style:segment_1_missing_reference")));
	assert.equal(result.segments.length, 2);
});

test("D.7 integration: runProcessingChain preserves score outputs across deform+blend+style+artifact route", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const sourceMask = Buffer.from([
		0, 0, 0, 0, 0,
		0, 128, 255, 128, 0,
		0, 255, 255, 255, 0,
		0, 128, 255, 128, 0,
		0, 0, 0, 0, 0
	]);
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-d7-integration",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			return [{
				label: "target",
				mask: Buffer.from(sourceMask),
				confidence: 0.92,
				width: 5,
				height: 5
			}];
		}
	};

	try {
		setMlSegmentAdapterOverrideForTests(segmentationAdapter);
		const result = await runProcessingChain({
			image: Buffer.from([9, 9, 9]),
			deformation: {
				mode: "affine",
				anchors: [
					{ x: 0, y: 0, dx: 1, dy: 0 },
					{ x: 4, y: 0, dx: 1, dy: 0 },
					{ x: 0, y: 4, dx: 1, dy: 0 }
				],
				constraints: { maxDisplacement: 1, clampToBounds: true }
			},
			blend: {
				mode: "multi-band",
				strength: 1
			},
			style: {
				textureConsistency: 0.8,
				edgeConsistency: 0.8,
				toneConsistency: 0.8,
				warningThreshold: 0.5
			},
			artifact: {
				threshold: 0.95
			}
		}, {
			imagePreprocess: false,
			svgOptimize: false,
			mlSegment: true
		});

		assert.equal(result.mlSegments?.length, 1);
		assert.ok(result.maskQuality);
		assert.ok((result.maskQuality?.aggregate.iouSurrogate ?? 0) > 0);
		assert.ok(result.styleConsistency);
		assert.ok((result.styleConsistency?.aggregateScore ?? 0) > 0);
		assert.ok(result.artifactScore);
		assert.equal(result.artifactScore?.threshold, 0.95);
		assert.equal(result.artifactScore?.exceeded, false);
		assert.equal(result.warnings.some((warning) => warning.startsWith("artifact:score_above_threshold:")), false);
	} finally {
		setMlSegmentAdapterOverrideForTests(undefined);
	}
});

test("D.8 e2e: real png sample runs full chain and returns stable scores", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const sampleImage = await createSamplePng(64, 64);
	const sourceMask = Buffer.from([
		0, 0, 0, 0, 0, 0,
		0, 64, 160, 220, 64, 0,
		0, 160, 255, 255, 160, 0,
		0, 220, 255, 255, 220, 0,
		0, 64, 160, 220, 64, 0,
		0, 0, 0, 0, 0, 0
	]);
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-d8-e2e",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			return [{
				label: "subject",
				mask: Buffer.from(sourceMask),
				confidence: 0.95,
				width: 6,
				height: 6
			}];
		}
	};

	try {
		setMlSegmentAdapterOverrideForTests(segmentationAdapter);
		const result = await runProcessingChain({
			image: sampleImage,
			crop: { x: 4, y: 4, w: 56, h: 56 },
			resizeTo: { width: 32, height: 32 },
			deformation: {
				mode: "affine",
				anchors: [
					{ x: 0, y: 0, dx: 1, dy: 1 },
					{ x: 5, y: 0, dx: 0, dy: 1 },
					{ x: 0, y: 5, dx: 1, dy: 0 }
				],
				constraints: { maxDisplacement: 1.5, clampToBounds: true }
			},
			blend: {
				mode: "multi-band",
				strength: 0.9
			},
			style: {
				textureConsistency: 0.75,
				edgeConsistency: 0.8,
				toneConsistency: 0.75,
				warningThreshold: 0
			},
			artifact: {
				threshold: 1
			}
		}, {
			imagePreprocess: true,
			svgOptimize: false,
			mlSegment: true
		});

		assert.deepEqual(await readDimensions(result.image as Buffer), { width: 32, height: 32 });
		assert.equal(result.mlSegments?.length, 1);
		assert.ok(result.maskQuality);
		assert.ok(result.styleConsistency);
		assert.ok(result.artifactScore);
		assert.ok(Number.isFinite(result.maskQuality?.aggregate.iouSurrogate));
		assert.ok(Number.isFinite(result.styleConsistency?.aggregateScore));
		assert.ok(Number.isFinite(result.artifactScore?.aggregateScore));
		assert.equal(result.artifactScore?.threshold, 1);
		assert.equal(result.artifactScore?.exceeded, false);
		assert.equal(result.warnings.some((warning) => warning.startsWith("restoration:")), false);
	} finally {
		setMlSegmentAdapterOverrideForTests(undefined);
	}
});

test("D.9 cross-check: threshold params, warning logs, and score flags stay consistent", { skip: HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED }, async () => {
	const segmentationAdapter: MlSegmentAdapter = {
		capability: {
			name: "test-seg-d9-cross-check",
			license: "MIT",
			runtimeRequirement: "none",
			performanceTier: "A"
		},
		async segment(_input: Buffer) {
			return [{
				label: "subject",
				mask: Buffer.from([
					0, 0, 0, 0, 0,
					0, 64, 192, 64, 0,
					0, 192, 255, 192, 0,
					0, 64, 192, 64, 0,
					0, 0, 0, 0, 0
				]),
				confidence: 0.9,
				width: 5,
				height: 5
			}];
		}
	};

	try {
		setMlSegmentAdapterOverrideForTests(segmentationAdapter);
		const result = await runProcessingChain({
			image: await createSamplePng(32, 32),
			deformation: {
				mode: "affine",
				anchors: [
					{ x: 0, y: 0, dx: 1, dy: 0 },
					{ x: 4, y: 0, dx: 0, dy: 1 },
					{ x: 0, y: 4, dx: 1, dy: 1 }
				],
				constraints: { maxDisplacement: 1.2, clampToBounds: true }
			},
			blend: {
				mode: "multi-band",
				strength: 1
			},
			style: {
				textureConsistency: 0.7,
				edgeConsistency: 0.8,
				toneConsistency: 0.7,
				warningThreshold: 1.5
			},
			artifact: {
				threshold: -0.2
			}
		}, {
			imagePreprocess: false,
			svgOptimize: false,
			mlSegment: true
		});

		assert.ok(result.styleConsistency);
		assert.ok(result.artifactScore);
		assert.equal(result.styleConsistency?.threshold, 1);
		assert.equal(result.artifactScore?.threshold, 0);

		const styleBelow = (result.styleConsistency?.aggregateScore ?? 0) < (result.styleConsistency?.threshold ?? 0);
		const artifactExceeded = (result.artifactScore?.aggregateScore ?? 0) > (result.artifactScore?.threshold ?? 0);

		assert.equal(result.styleConsistency?.belowThreshold, styleBelow);
		assert.equal(result.artifactScore?.exceeded, artifactExceeded);
		assert.equal(result.warnings.some((warning) => warning.startsWith("style:consistency_below_threshold:")), styleBelow);
		assert.equal(result.warnings.some((warning) => warning.startsWith("artifact:score_above_threshold:")), artifactExceeded);
	} finally {
		setMlSegmentAdapterOverrideForTests(undefined);
	}
});
