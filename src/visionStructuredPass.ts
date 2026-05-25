import * as vscode from "vscode";
import { createHash } from "node:crypto";
import type { ExtensionSettings, ModelConfig } from "./types";
import {
	executeStructuredVisionLmWithRetry,
	resolveStructuredVisionFormatMaxAttempts,
	resolveStructuredVisionHttpRetry
} from "./visionStructuredRetryPolicy";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "./config/highFidelityRestoreImagePipelineSuspended";
import {
	buildMinimalStructuredVisionFallback,
	normalizeStructuredProxyOutput,
	STRUCTURED_PROXY_CONTRACT_VERSION,
	type ProxyBBox,
	type ProxyStructuredOutput,
	type ProxyVisualElement
} from "./visionProxyStructuredPlan";
import {
	resolveVisionHandoffIntent,
	type VisionHandoffIntent
} from "./visionProtocol/visionHandoffIntent";
import { extractJsonObjectFromVisionText } from "./visionProtocol/visionJsonExtract";
import { clampProxyBBoxToImage } from "./visionProxyBBox";
import { resolveHintedSvgFromElement } from "./visionRestoreSeed";
import {
	isRestoreElementOutputAcceptable,
	produceRestoreElementOutputs
} from "./toolCooperation/visionRestoreElementOutput";
import { Logger } from "./logger";
import { errorMessages } from "./toolCooperation/outputSemantics";
import { runProcessingChain } from "./toolCooperation/resultAssembler";
import { getImageAnalyzeAdapter } from "./toolCooperation/adapters/registry";
import { compositeRasterPatchOntoImage } from "./toolCooperation/visionRestoreRasterComposite";
import { refineVisionRestorePlan } from "./toolCooperation/visionRestorePlanRefinement";
import { applyOptionalVisionThreshold } from "./toolCooperation/visionThresholdFallback";
import { isBboxPlaceholderSvg, resolveProductionSvgOutput } from "./toolCooperation/visionSvgFidelity";
import { validateImageIntegrity, replaceImageInputPartData } from "./providerVisionIntegrity";
import { runWithSuppressedVisionOrchestration } from "./visionOrchestrationContext";
import { sendChatCompletion } from "./openaiCompat/client";
import { buildHeaders, buildRequestBody } from "./openaiCompat/request";
import { convertMessages } from "./openaiCompat/messages";

export interface ProxyExecutionSummary {
	success: boolean;
	retryable: boolean;
	failureOrigin?: "proxy-format" | "proxy-params" | "image-processing";
	failureReason?: string;
	processedImages: number;
	warnings: string[];
	svgOutputs: string[];
	processedImageParts?: vscode.LanguageModelDataPart[];
}

export {
	resolveStructuredVisionFormatMaxAttempts,
	resolveStructuredVisionHttpRetry
} from "./visionStructuredRetryPolicy";

function toUint8Array(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) {
		return value;
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView;
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}
	if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
		return new Uint8Array(value);
	}
	return undefined;
}
export async function resolveStructuredProxyDescription(
	proxyModel: vscode.LanguageModelChat,
	imageParts: readonly vscode.LanguageModelDataPart[],
	basePrompt: string,
	settings: ExtensionSettings,
	logger: Logger,
	token: vscode.CancellationToken,
	handoffIntent: VisionHandoffIntent
): Promise<{ description: string; execution: ProxyExecutionSummary; structured?: ProxyStructuredOutput }> {
	return resolveStructuredVisionDescription(
		(imageParts, prompt, attempt, maxAttempts, cancellation, opts) =>
			requestStructuredProxyOutput(proxyModel, imageParts, prompt, attempt, maxAttempts, settings, cancellation, opts, logger),
		imageParts,
		basePrompt,
		settings,
		logger,
		token,
		handoffIntent,
		"proxy"
	);
}

export async function resolveStructuredNativeDescription(
	model: ModelConfig,
	apiKey: string,
	imageParts: readonly vscode.LanguageModelDataPart[],
	basePrompt: string,
	settings: ExtensionSettings,
	logger: Logger,
	token: vscode.CancellationToken,
	handoffIntent: VisionHandoffIntent
): Promise<{ description: string; execution: ProxyExecutionSummary; structured?: ProxyStructuredOutput }> {
	return resolveStructuredVisionDescription(
		(parts, prompt, attempt, maxAttempts, cancellation, opts) =>
			requestStructuredNativeOutput(model, apiKey, parts, prompt, attempt, maxAttempts, cancellation, settings, opts),
		imageParts,
		basePrompt,
		settings,
		logger,
		token,
		handoffIntent,
		"native"
	);
}

type StructuredVisionPassRoute = "proxy" | "native";

async function resolveStructuredVisionDescription(
	requestOutput: (
		imageParts: readonly vscode.LanguageModelDataPart[],
		basePrompt: string,
		attempt: number,
		maxAttempts: number,
		token: vscode.CancellationToken,
		options: { forceNonSvgMode?: boolean; handoffIntent?: VisionHandoffIntent }
	) => Promise<string>,
	imageParts: readonly vscode.LanguageModelDataPart[],
	basePrompt: string,
	settings: ExtensionSettings,
	logger: Logger,
	token: vscode.CancellationToken,
	handoffIntent: VisionHandoffIntent,
	route: StructuredVisionPassRoute
): Promise<{ description: string; execution: ProxyExecutionSummary; structured?: ProxyStructuredOutput }> {
	const maxAttempts = resolveStructuredVisionFormatMaxAttempts(settings);
	let lastFailure: string | undefined;
	let cachedStructuredPlan: ProxyStructuredOutput | undefined;
	let replayStructuredPlan = false;

	let forceNonSvgMode = false;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		let parsed: ReturnType<typeof parseStructuredProxyOutput>;
		if (replayStructuredPlan && cachedStructuredPlan) {
			logger.info(route === "proxy" ? "vision.proxy.plan.replay" : "vision.native.plan.replay", {
				attempt,
				maxAttempts,
				reason: "reuse-structured-plan-without-vision-api"
			});
			parsed = { ok: true, value: cachedStructuredPlan };
			replayStructuredPlan = false;
		} else {
			const raw = await requestOutput(
				imageParts,
				basePrompt,
				attempt,
				maxAttempts,
				token,
				{ forceNonSvgMode, handoffIntent }
			);
			parsed = parseStructuredProxyOutput(raw, logger);
		}
		if (!parsed.ok) {
			lastFailure = `invalid format: ${parsed.error}`;
			logger.warn("vision.proxy.format.invalid", {
				attempt,
				maxAttempts,
				error: parsed.error
			});
			continue;
		}
		cachedStructuredPlan = parsed.value;

		const execution = await executeProxyPlan(imageParts, parsed.value, settings, logger, handoffIntent);
		if (!execution.success) {
			lastFailure = execution.failureReason;
			logger.warn("vision.proxy.plan.execution.failed", {
				attempt,
				maxAttempts,
				origin: execution.failureOrigin,
				reason: execution.failureReason,
				retryable: execution.retryable
			});
			if (
				execution.retryable
				&& attempt < maxAttempts
				&& (execution.failureReason?.includes("svg-fidelity") ?? false)
			) {
				forceNonSvgMode = true;
				replayStructuredPlan = true;
				continue;
			}
			if (execution.retryable && attempt < maxAttempts) {
				replayStructuredPlan = true;
				continue;
			}
			throw new Error(renderExecutionFailure(parsed.value, execution, attempt, maxAttempts));
		}

		return {
			description: renderStructuredProxyDescription(parsed.value, execution, attempt, maxAttempts),
			execution,
			structured: parsed.value
		};
	}

	const formatFallbackEligible = Boolean(
		lastFailure?.includes("at least one visual element is required")
		|| lastFailure?.includes("sceneSummary or element rationale is required")
		|| lastFailure?.startsWith("invalid format:")
	);
	if (formatFallbackEligible) {
		const fallbackPlan = buildMinimalStructuredVisionFallback();
		const execution = await executeProxyPlan(imageParts, fallbackPlan, settings, logger, handoffIntent);
		if (execution.success) {
			logger.info(route === "native" ? "vision.native.structured.format-fallback" : "vision.proxy.structured.format-fallback", {
				lastFailure,
				handoffIntent,
				elementCount: fallbackPlan.elements.length
			});
			return {
				description: renderStructuredProxyDescription(fallbackPlan, execution, maxAttempts, maxAttempts),
				execution,
				structured: fallbackPlan
			};
		}
	}

	throw new Error([
		errorMessages.visionProxyFailed,
		renderProxyDebugDetails(
			"视觉代理调试 · 格式校验失败",
			[`status=failed reason=${lastFailure ?? "unknown"} retries=${maxAttempts}`]
		)
	].join("\n"));
}

async function requestStructuredProxyOutput(
	proxyModel: vscode.LanguageModelChat,
	imageParts: readonly vscode.LanguageModelDataPart[],
	basePrompt: string,
	attempt: number,
	maxAttempts: number,
	settings: ExtensionSettings,
	token: vscode.CancellationToken,
	options: { forceNonSvgMode?: boolean; handoffIntent?: VisionHandoffIntent } = {},
	logger?: Logger
): Promise<string> {
	const handoffIntent = options.handoffIntent ?? resolveVisionHandoffIntent(basePrompt);
	const contractPrompt = buildStructuredVisionContractPrompt(basePrompt, attempt, maxAttempts, {
		forceNonSvgMode: options.forceNonSvgMode,
		handoffIntent
	});

	const visionMessage = vscode.LanguageModelChatMessage.User([
		...imageParts,
		new vscode.LanguageModelTextPart(contractPrompt)
	]);
	const modelLabel = proxyModel.name ?? proxyModel.id ?? "proxy";
	const runOnce = async (): Promise<string> => runWithSuppressedVisionOrchestration(async () => {
		const response = await proxyModel.sendRequest([visionMessage], {}, token);
		let description = "";
		for await (const chunk of response.stream) {
			if (chunk instanceof vscode.LanguageModelTextPart) {
				description += chunk.value;
			}
		}
		return description;
	});
	if (!logger) {
		return runOnce();
	}
	return executeStructuredVisionLmWithRetry(runOnce, settings, logger, { route: "proxy", modelLabel });
}

async function requestStructuredNativeOutput(
	model: ModelConfig,
	apiKey: string,
	imageParts: readonly vscode.LanguageModelDataPart[],
	basePrompt: string,
	attempt: number,
	maxAttempts: number,
	token: vscode.CancellationToken,
	settings: ExtensionSettings,
	options: { forceNonSvgMode?: boolean; handoffIntent?: VisionHandoffIntent } = {}
): Promise<string> {
	const handoffIntent = options.handoffIntent ?? resolveVisionHandoffIntent(basePrompt);
	const contractPrompt = buildStructuredVisionContractPrompt(basePrompt, attempt, maxAttempts, {
		forceNonSvgMode: options.forceNonSvgMode,
		handoffIntent
	});
	const visionMessage = vscode.LanguageModelChatMessage.User([
		...imageParts,
		new vscode.LanguageModelTextPart(contractPrompt)
	]);
	const roleIds = {
		user: vscode.LanguageModelChatMessageRole.User,
		assistant: vscode.LanguageModelChatMessageRole.Assistant
	};
	const openAiMessages = convertMessages([visionMessage], model, roleIds);
	const body = buildRequestBody(
		model,
		openAiMessages,
		{ tools: [] } as unknown as vscode.ProvideLanguageModelChatResponseOptions,
		undefined
	);
	const headers = buildHeaders(apiKey, model);
	let description = "";
	await sendChatCompletion({
		model,
		apiKey,
		body,
		headers,
		retry: resolveStructuredVisionHttpRetry(settings),
		timeoutMs: settings.requestTimeoutMs,
		cancellation: token,
		onEvent: (event) => {
			if (event.type === "text") {
				description += event.text;
			}
		}
	});
	return description;
}

function buildStructuredVisionContractPrompt(
	basePrompt: string,
	attempt: number,
	maxAttempts: number,
	options: { forceNonSvgMode?: boolean; handoffIntent: VisionHandoffIntent }
): string {
	const describeOnlyTask = options.handoffIntent === "describe-only";
	const restoreTask = options.handoffIntent === "restore-artifact";
	return [
		`[${STRUCTURED_PROXY_CONTRACT_VERSION}]`,
		"You must return exactly one JSON object, without markdown fences.",
		"You are producing durable visual evidence for a downstream non-vision model. It will not see the image, so your output must be detailed enough for it to continue the task without rescanning the workspace or requesting another image.",
		"Do not answer with only a coarse category such as 'phone homescreen screenshot with multiple app icons and widgets'. Provide concrete scene detail, layout, visible text, and actionable observations.",
		"Return ONE JSON object with an elements[] array. Each distinct visual component (button, icon, panel, badge, text block, chip, avatar, divider, etc.) MUST be its own element with its own mode, regions, imageParams, and svgParams.",
		"Never collapse a complex UI into a single element. Never return multiple root JSON objects or a nested tree outside elements[].",
		...(describeOnlyTask
			? ["User task is describe-only (no PNG/SVG restoration artifacts). Use mode=none or mode=image for observations only; do not use mode=svg."]
			: []),
		...(restoreTask
			? [
				"User task is restore-artifact: decompose the UI into many elements. For EACH element YOU choose mode=image (matting/photo regions) OR mode=svg (flat icons/logos/geometric controls).",
				"Never use one element for the full viewport. Never collapse the scene into a single bbox.",
				"Include imageParams.crop per element; svg elements need svgParams (path-guided when possible)."
			]
			: []),
		...(options.forceNonSvgMode
			? ["Previous SVG vectorization failed production fidelity checks. Retry with per-element mode=image or mode=none only; do not use mode=svg."]
			: []),
		"Scene-level fields summarize the whole image. Element-level fields drive per-component processing.",
		"Schema:",
		"{",
		`  "contract": "${STRUCTURED_PROXY_CONTRACT_VERSION}",`,
		"  \"sceneSummary\": \"string\",",
		"  \"observations\": [\"string\", ...],",
		"  \"recognizedText\": [\"string\", ...],",
		"  \"layout\": [\"string\", ...],",
		"  \"elements\": [{",
		"    \"elementId\": \"string\",",
		"    \"label\": \"string\",",
		"    \"mode\": \"image\" | \"svg\" | \"none\",",
		"    \"confidence\": 0..1,",
		"    \"rationale\": \"string\",",
		"    \"observations\": [\"string\", ...],",
		"    \"recognizedText\": [\"string\", ...],",
		"    \"layout\": [\"string\", ...],",
		"    \"regions\": [{ \"label\": \"string\", \"bbox\": {x,y,w,h}, \"confidence\": 0..1, \"priority\": integer>=1, \"rationale\": \"string\" }],",
		"    \"imageParams\": { \"crop\"?: bbox, \"resize\"?: {\"width\": number>0, \"height\": number>0}, \"threshold\"?: 0..255 },",
		"    \"svgParams\": { \"mode\": \"bbox-overlay\" | \"path-guided\", \"strokeWidth\"?: number>0, \"fillColor\"?: \"#RRGGBB\", \"pathHint\"?: \"string\" }",
		"  }]",
		"}",
		`attempt=${attempt}/${maxAttempts}`,
		"If previous attempt failed, correct format/params and return valid executable values.",
		"User task:",
		basePrompt
	].join("\n");
}

function parseStructuredProxyOutput(
	raw: string,
	logger?: Logger
): { ok: true; value: ProxyStructuredOutput } | { ok: false; error: string } {
	const extracted = extractJsonObjectFromVisionText(raw);
	if (!extracted) {
		return { ok: false, error: "response is not a valid JSON object" };
	}
	if (extracted.repaired) {
		logger?.info("vision.proxy.format.repaired", { stage: "parse-structured-proxy-output" });
	}
	return normalizeStructuredProxyOutput(extracted.value);
}
async function executeProxyPlan(
	imageParts: readonly vscode.LanguageModelDataPart[],
	plan: ProxyStructuredOutput,
	settings: ExtensionSettings,
	logger: Logger,
	handoffIntent: VisionHandoffIntent
): Promise<ProxyExecutionSummary> {
	if (handoffIntent === "describe-only") {
		logger.info("vision.restore.pipeline.skipped", {
			handoffIntent,
			reason: "describe-only"
		});
		return {
			success: true,
			retryable: false,
			processedImages: 0,
			warnings: ["restore-pipeline:skipped-describe-only"],
			svgOutputs: [],
			processedImageParts: Array.from(imageParts)
		};
	}

	let hostUiSmokeRestoreSourceSnapshot: Buffer | undefined;
	const analyzer = getImageAnalyzeAdapter();
	let workingPlan = plan;
	if (handoffIntent === "restore-artifact") {
		if (imageParts.length === 0) {
			logger.warn("vision.restore.pipeline.failed", { reason: "no-image-parts" });
			return {
				success: false,
				retryable: true,
				failureOrigin: "proxy-params",
				failureReason: "restore-pipeline:no-image-parts",
				processedImages: 0,
				warnings: ["restore-pipeline:no-image-parts"],
				svgOutputs: [],
				processedImageParts: Array.from(imageParts)
			};
		}
		if (HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED) {
			logger.info("vision.restore.pipeline.skipped", {
				handoffIntent,
				reason: "image-pipeline-suspended",
				imagePartCount: imageParts.length
			});
			return {
				success: true,
				retryable: false,
				processedImages: 0,
				warnings: ["restore-pipeline:image-postprocessing-suspended"],
				svgOutputs: [],
				processedImageParts: Array.from(imageParts)
			};
		}
		const seed = Buffer.from(imageParts[0].data as Uint8Array);
		if (process.env.COPILOT_BRO_UI_SMOKE === "1") {
			hostUiSmokeRestoreSourceSnapshot = Buffer.from(seed);
		}
		const meta = await analyzer.getMetadata(seed);
		const imageWidth = Math.max(1, meta.width ?? 1);
		const imageHeight = Math.max(1, meta.height ?? 1);
		const refined = refineVisionRestorePlan(workingPlan, imageWidth, imageHeight);
		if (refined.adjustments.length > 0) {
			logger.info("vision.restore.plan.refined", {
				adjustments: refined.adjustments,
				elementCount: refined.plan.elements.length
			});
		}
		workingPlan = refined.plan;
	}

	const activeElements = workingPlan.elements.filter((element) => element.mode !== "none");
	if (activeElements.length === 0) {
		if (handoffIntent === "restore-artifact") {
			logger.warn("vision.restore.pipeline.failed", {
				reason: "no-actionable-elements"
			});
			return {
				success: false,
				retryable: true,
				failureOrigin: "proxy-params",
				failureReason: "restore-pipeline:no-actionable-elements",
				processedImages: 0,
				warnings: ["restore-pipeline:no-actionable-elements"],
				svgOutputs: [],
				processedImageParts: Array.from(imageParts)
			};
		}
		return {
			success: true,
			retryable: false,
			processedImages: 0,
			warnings: [],
			svgOutputs: [],
			processedImageParts: Array.from(imageParts)
		};
	}

	logger.info("vision.restore.pipeline.start", {
		handoffIntent,
		elementCount: activeElements.length,
		imagePartCount: imageParts.length
	});

	let processedImages = 0;
	const warnings: string[] = [];
	const svgOutputs: string[] = [];
	const processedParts: vscode.LanguageModelDataPart[] = [];

	for (const part of imageParts) {
		let partEmitted = false;
		for (const element of activeElements) {
			const elementResult = await executeProxyElementPlan(part, element, settings, logger, analyzer, handoffIntent);
			warnings.push(...elementResult.warnings);
			if (!elementResult.success) {
				return {
					...elementResult,
					processedImages,
					warnings,
					svgOutputs
				};
			}
			processedImages += elementResult.processedImages;
			svgOutputs.push(...elementResult.svgOutputs);
			if (elementResult.processedImagePart) {
				processedParts.push(elementResult.processedImagePart);
				partEmitted = true;
			} else if (element.mode === "svg" || elementResult.svgOutputs.length > 0) {
				processedParts.push(part);
				partEmitted = true;
			}
		}
		if (!partEmitted) {
			processedParts.push(part);
		}
	}

	if (handoffIntent === "restore-artifact" && imageParts.length > 0) {
		const bytesForCapture =
			hostUiSmokeRestoreSourceSnapshot ?? Buffer.from(imageParts[0].data as Uint8Array);
		if (process.env.COPILOT_BRO_UI_SMOKE === "1") {
			const { captureHostUiSmokeBenchmarkPageSsimInputIfSmokeRestore } = await import(
				"./e2e/hostUi/benchmark/pageSsim.js"
			);
			await captureHostUiSmokeBenchmarkPageSsimInputIfSmokeRestore(bytesForCapture, workingPlan, logger);
		}
	}

	return {
		success: true,
		retryable: false,
		processedImages,
		warnings,
		svgOutputs,
		processedImageParts: processedParts.length > 0 ? processedParts : Array.from(imageParts)
	};
}

interface ProxyElementExecutionResult extends ProxyExecutionSummary {
	processedImagePart?: vscode.LanguageModelDataPart;
}

async function executeRestoreArtifactElementPlan(
	part: vscode.LanguageModelDataPart,
	element: ProxyVisualElement,
	settings: ExtensionSettings,
	logger: Logger,
	analyzer: ReturnType<typeof getImageAnalyzeAdapter>,
	original: Buffer,
	preferredRegion: ProxyBBox | undefined
): Promise<ProxyElementExecutionResult> {
	const elementTag = element.elementId;
	if (!preferredRegion) {
		logger.warn("vision.restore.pipeline.failed", {
			elementId: elementTag,
			reason: "missing-crop"
		});
		return {
			success: false,
			retryable: true,
			failureOrigin: "proxy-params",
			failureReason: `element ${elementTag}: restore requires crop region`,
			processedImages: 0,
			warnings: [`restore-pipeline:missing_crop:${elementTag}`],
			svgOutputs: []
		};
	}

	const warnings: string[] = [];
	try {
		const imageMeta = await safeImageMeta(analyzer, original);
		if (!imageMeta) {
			return {
				success: false,
				retryable: true,
				failureOrigin: "proxy-params",
				failureReason: `element ${elementTag}: cannot read image metadata`,
				processedImages: 0,
				warnings: ["restore-pipeline:missing-image-meta"],
				svgOutputs: []
			};
		}
		const cropRegion = clampProxyBBoxToImage(preferredRegion, imageMeta.width, imageMeta.height);
		if (cropRegion.w !== preferredRegion.w || cropRegion.h !== preferredRegion.h) {
			logger.info("vision.restore.bbox.clamped", {
				elementId: elementTag,
				before: preferredRegion,
				after: cropRegion,
				imageWidth: imageMeta.width,
				imageHeight: imageMeta.height
			});
		}

		const outputs = await produceRestoreElementOutputs({
			original,
			element,
			imageWidth: imageMeta.width,
			imageHeight: imageMeta.height,
			settings,
			allowBBoxPlaceholderSvg: settings.visionProcessing.allowBBoxPlaceholderSvg === true
		});
		warnings.push(...outputs.warnings);

		const vectorChain = outputs.svgChain;
		if (vectorChain?.rasterVectorize) {
			logger.info("vision.raster.vectorize", {
				elementId: elementTag,
				engine: vectorChain.rasterVectorize.engine,
				pathCount: vectorChain.rasterVectorize.pathCount,
				width: vectorChain.rasterVectorize.width,
				height: vectorChain.rasterVectorize.height
			});
		}
		if (outputs.fidelityReport) {
			logger.info("vision.restore.fidelity.report", outputs.fidelityReport);
		}

		if (outputs.integrityWarnings.length > 0) {
			logger.warn("vision.restore.pipeline.failed", {
				elementId: elementTag,
				reason: "integrity",
				integrityWarnings: outputs.integrityWarnings
			});
			return {
				success: false,
				retryable: true,
				failureOrigin: outputs.integrityWarnings.some((item) => item.includes("invalid") || item.includes("dimension"))
					? "proxy-params"
					: "image-processing",
				failureReason: `element ${elementTag}: integrity check failed: ${outputs.integrityWarnings.join(",")}`,
				processedImages: 0,
				warnings,
				svgOutputs: []
			};
		}

		if (!isRestoreElementOutputAcceptable(outputs, { requireSvgStructural: false })) {
			logger.warn("vision.restore.pipeline.failed", {
				elementId: elementTag,
				reason: element.mode === "image" ? "raster-output-missing" : "vector-or-raster-missing",
				mode: element.mode,
				usedPlaceholder: outputs.usedPlaceholder
			});
			return {
				success: false,
				retryable: true,
				failureOrigin: "image-processing",
				failureReason:
					element.mode === "image"
						? `element ${elementTag}: raster restore failed`
						: outputs.usedPlaceholder
							? "svg-fidelity:bbox-placeholder-disabled"
							: "svg-fidelity:missing-vector-output",
				processedImages: 0,
				warnings,
				svgOutputs: []
			};
		}

		if (element.mode === "svg" && !outputs.svgStructuralPassed) {
			warnings.push(
				...(outputs.fidelityReport?.failureReasons.map((r) => `fidelity:${r}`) ?? ["fidelity:structural-degraded"])
			);
			logger.warn("vision.restore.svg.structural-degraded", {
				elementId: elementTag,
				failureReasons: outputs.fidelityReport?.failureReasons
			});
		}
		if (outputs.usedPlaceholder) {
			warnings.push("svg-fidelity:placeholder-fallback");
		}

		const chainImage = outputs.productionPng;
		const productionSvg = outputs.productionSvg;
		const svgOutputs = productionSvg ? [productionSvg] : [];

		logger.info("vision.restore.pipeline.complete", {
			elementId: elementTag,
			mode: element.mode,
			svgBytes: productionSvg?.length ?? 0,
			pngBytes: chainImage.length,
			fidelityPassed: outputs.fidelityReport?.passed ?? element.mode === "image",
			rasterEngine: vectorChain?.rasterVectorize?.engine,
			rasterPathCount: vectorChain?.rasterVectorize?.pathCount,
			warningCount: warnings.length,
			usedPlaceholder: outputs.usedPlaceholder,
			svgStructuralPassed: outputs.svgStructuralPassed
		});

		const mergedFullFrame = await compositeRasterPatchOntoImage(original, chainImage, cropRegion);
		const processedPart = replaceImageInputPartData(
			part as { mimeType: string; data: Uint8Array } & Record<string, unknown>,
			mergedFullFrame
		);
		return {
			success: true,
			retryable: false,
			processedImages: 1,
			warnings,
			svgOutputs,
			processedImagePart: processedPart as vscode.LanguageModelDataPart
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.warn("vision.restore.pipeline.failed", {
			elementId: elementTag,
			reason: "exception",
			error: message
		});
		return {
			success: false,
			retryable: true,
			failureOrigin: "image-processing",
			failureReason: message,
			processedImages: 0,
			warnings,
			svgOutputs: []
		};
	}
}

async function executeProxyElementPlan(
	part: vscode.LanguageModelDataPart,
	element: ProxyVisualElement,
	settings: ExtensionSettings,
	logger: Logger,
	analyzer: ReturnType<typeof getImageAnalyzeAdapter>,
	handoffIntent: VisionHandoffIntent
): Promise<ProxyElementExecutionResult> {
	if (element.mode === "none") {
		return {
			success: true,
			retryable: false,
			processedImages: 0,
			warnings: [],
			svgOutputs: []
		};
	}
	if (element.regions.length === 0) {
		return {
			success: false,
			retryable: true,
			failureOrigin: "proxy-params",
			failureReason: `element ${element.elementId}: missing regions`,
			processedImages: 0,
			warnings: [`proxy-params:missing_regions:${element.elementId}`],
			svgOutputs: []
		};
	}

	const bytes = toUint8Array(part.data);
	if (!bytes) {
		return {
			success: true,
			retryable: false,
			processedImages: 0,
			warnings: [`image-processing:missing_bytes:${element.elementId}`],
			svgOutputs: []
		};
	}
	const original = Buffer.from(bytes);
	const rawRegion = element.imageParams?.crop ?? element.regions[0]?.bbox;
	const originalMetaForCrop = rawRegion ? await safeImageMeta(analyzer, original) : undefined;
	const preferredRegion = rawRegion && originalMetaForCrop
		? clampProxyBBoxToImage(rawRegion, originalMetaForCrop.width, originalMetaForCrop.height)
		: rawRegion;
	const elementTag = element.elementId;
	const restoreArtifact = handoffIntent === "restore-artifact";

	logger.info("vision.restore.element.start", {
		elementId: elementTag,
		mode: element.mode,
		handoffIntent,
		regionCount: element.regions.length
	});

	if (restoreArtifact) {
		return executeRestoreArtifactElementPlan(
			part,
			element,
			settings,
			logger,
			analyzer,
			original,
			preferredRegion
		);
	}

	if (element.mode === "image") {
		if (!preferredRegion) {
			return {
				success: false,
				retryable: true,
				failureOrigin: "proxy-params",
				failureReason: `element ${elementTag}: image mode requires crop region`,
				processedImages: 0,
				warnings: [],
				svgOutputs: []
			};
		}
		try {
			let chainImage: Buffer = Buffer.from(original);
			const warnings: string[] = [];
			const chainResult = await runProcessingChain({
				image: chainImage,
				crop: preferredRegion,
				resizeTo: element.imageParams?.resize
			}, {
				imagePreprocess: true,
				svgOptimize: settings.visionProcessing.svgOptimize,
				mlSegment: settings.visionProcessing.mlSegment,
				svgDecisionPolicy: settings.visionProcessing.svgDecisionPolicy,
				rasterPolicy: settings.visionProcessing.rasterPolicy
			});
			chainImage = Buffer.from(chainResult.image ?? chainImage);
			if (typeof element.imageParams?.threshold === "number") {
				chainImage = await applyOptionalVisionThreshold(
					analyzer,
					chainImage,
					element.imageParams.threshold,
					warnings,
					logger
				);
			}
			const originalDigest = createHash("sha256").update(original).digest("hex");
			const candidateDigest = createHash("sha256").update(chainImage).digest("hex");
			const originalMeta = await safeImageMeta(analyzer, original);
			const candidateMeta = await safeImageMeta(analyzer, chainImage);
			const integrityWarnings = validateImageIntegrity(
				settings,
				original,
				chainImage,
				originalDigest,
				candidateDigest,
				originalMeta,
				candidateMeta
			);
			warnings.push(...chainResult.warnings, ...integrityWarnings);
			if (integrityWarnings.length > 0) {
				return {
					success: false,
					retryable: true,
					failureOrigin: integrityWarnings.some((item) => item.includes("invalid") || item.includes("dimension"))
						? "proxy-params"
						: "image-processing",
					failureReason: `element ${elementTag}: integrity check failed: ${integrityWarnings.join(",")}`,
					processedImages: 0,
					warnings,
					svgOutputs: []
				};
			}
			const processedPart = replaceImageInputPartData(part as { mimeType: string; data: Uint8Array } & Record<string, unknown>, chainImage);
			return {
				success: true,
				retryable: false,
				processedImages: 1,
				warnings,
				svgOutputs: [],
				processedImagePart: processedPart as vscode.LanguageModelDataPart
			};
		} catch (error) {
			logger.warn("vision.proxy.image.processing.error", {
				elementId: elementTag,
				error: error instanceof Error ? error.message : String(error)
			});
			return {
				success: false,
				retryable: true,
				failureOrigin: "image-processing",
				failureReason: error instanceof Error ? error.message : String(error),
				processedImages: 0,
				warnings: [],
				svgOutputs: []
			};
		}
	}

	if (element.mode === "svg") {
		if (!preferredRegion) {
			return {
				success: false,
				retryable: true,
				failureOrigin: "proxy-params",
				failureReason: `element ${elementTag}: svg mode requires crop region`,
				processedImages: 0,
				warnings: [],
				svgOutputs: []
			};
		}
		try {
			const warnings: string[] = [];
			const hintedSvg = resolveHintedSvgFromElement(element, preferredRegion);
			const chainResult = await runProcessingChain({
				image: Buffer.from(original),
				crop: preferredRegion,
				resizeTo: element.imageParams?.resize,
				svg: hintedSvg
			}, {
				imagePreprocess: true,
				svgOptimize: settings.visionProcessing.svgOptimize,
				mlSegment: settings.visionProcessing.mlSegment,
				rasterVectorize: settings.visionProcessing.rasterVectorize !== false,
				svgDecisionPolicy: "always",
				rasterPolicy: settings.visionProcessing.rasterPolicy
			});
			warnings.push(...chainResult.warnings);
			const resolved = resolveProductionSvgOutput(
				chainResult.svg,
				hintedSvg,
				settings.visionProcessing.allowBBoxPlaceholderSvg === true
			);
			if (!resolved.svg) {
				return {
					success: false,
					retryable: true,
					failureOrigin: "image-processing",
					failureReason: resolved.rejectedPlaceholder
						? "svg-fidelity:bbox-placeholder-disabled"
						: "svg-fidelity:missing-vector-output",
					processedImages: 0,
					warnings: [...warnings, "svg-fidelity:production-output-missing"],
					svgOutputs: []
				};
			}
			if (resolved.usedPlaceholder) {
				logger.warn("vision.proxy.svg.placeholder-fallback", {
					elementId: elementTag,
					mode: element.mode,
					bboxPlaceholder: isBboxPlaceholderSvg(resolved.svg)
				});
				warnings.push("svg-fidelity:placeholder-fallback");
			}
			return {
				success: true,
				retryable: false,
				processedImages: 1,
				warnings,
				svgOutputs: [resolved.svg]
			};
		} catch (error) {
			logger.warn("vision.proxy.svg.processing.error", {
				elementId: elementTag,
				error: error instanceof Error ? error.message : String(error)
			});
			return {
				success: false,
				retryable: true,
				failureOrigin: "image-processing",
				failureReason: error instanceof Error ? error.message : String(error),
				processedImages: 0,
				warnings: [],
				svgOutputs: []
			};
		}
	}

	return {
		success: true,
		retryable: false,
		processedImages: 0,
		warnings: [],
		svgOutputs: []
	};
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

function renderStructuredProxyDescription(
	plan: ProxyStructuredOutput,
	summary: ProxyExecutionSummary,
	attempt: number,
	maxAttempts: number
): string {
	const snapshot = JSON.stringify({
		contract: plan.contract,
		sceneSummary: plan.sceneSummary,
		observations: plan.observations,
		recognizedText: plan.recognizedText,
		layout: plan.layout,
		elements: plan.elements.map((element) => ({
			elementId: element.elementId,
			label: element.label,
			mode: element.mode,
			confidence: Number(element.confidence.toFixed(2)),
			rationale: element.rationale,
			observations: element.observations,
			recognizedText: element.recognizedText,
			layout: element.layout,
			regions: element.regions.slice(0, 8).map((region) => ({
				label: region.label,
				confidence: Number(region.confidence.toFixed(2)),
				priority: region.priority,
				bbox: region.bbox,
				rationale: region.rationale
			})),
			imageParams: element.imageParams ?? {},
			svgParams: element.svgParams ?? {}
		}))
	}, null, 2);
	const elementLines = plan.elements.flatMap((element) => {
		const primary = element.regions[0];
		return [
			`elementId=${element.elementId} label=${element.label} mode=${element.mode} confidence=${element.confidence.toFixed(2)}`,
			`elementRationale=${element.rationale}`,
			...renderEvidenceSection(`element.${element.elementId}.layout`, element.layout),
			...renderEvidenceSection(`element.${element.elementId}.observations`, element.observations),
			...renderEvidenceSection(`element.${element.elementId}.recognizedText`, element.recognizedText),
			...renderEvidenceSection(
				`element.${element.elementId}.regions`,
				element.regions.slice(0, 8).map((region, index) => {
					const primaryFlag = primary === region || index === 0 ? " primary=true" : "";
					return `priority=${region.priority} label=${region.label} confidence=${region.confidence.toFixed(2)} bbox=x=${region.bbox.x},y=${region.bbox.y},w=${region.bbox.w},h=${region.bbox.h}${primaryFlag} rationale=${region.rationale}`;
				})
			),
			`element.${element.elementId}.imageParams=${JSON.stringify(element.imageParams ?? {})}`,
			`element.${element.elementId}.svgParams=${JSON.stringify(element.svgParams ?? {})}`
		];
	});
	const lines = [
		"proxyRecord=persisted",
		"evidenceScope=current-user-image authoritative=true",
		`contract=${plan.contract} status=ok retries=${attempt}/${maxAttempts}`,
		`elementCount=${plan.elements.length}`,
		`sceneSummary=${plan.sceneSummary}`,
		...renderEvidenceSection("layout", plan.layout),
		...renderEvidenceSection("observations", plan.observations),
		...renderEvidenceSection("recognizedText", plan.recognizedText),
		...elementLines,
		`processedImages=${summary.processedImages}`,
		summary.warnings.length > 0 ? `warnings=${summary.warnings.join("|")}` : "warnings=none",
		summary.svgOutputs.length > 0 ? `svgPreview=${summary.svgOutputs[0].slice(0, 400)}` : "svgPreview=none",
		"normalizedProxySnapshot:",
		snapshot
	];
	return lines.join("\n");
}

function renderEvidenceSection(title: string, items: readonly string[]): string[] {
	if (items.length === 0) {
		return [`${title}=none`];
	}
	return [
		`${title}:`,
		...items.map((item) => `- ${item}`)
	];
}

function renderExecutionFailure(
	plan: ProxyStructuredOutput,
	summary: ProxyExecutionSummary,
	attempt: number,
	maxAttempts: number
): string {
	const modes = plan.elements.map((element) => `${element.elementId}:${element.mode}`).join(",");
	const lines = [
		`status=failed retries=${attempt}/${maxAttempts}`,
		`origin=${summary.failureOrigin ?? "unknown"}`,
		`reason=${summary.failureReason ?? "unknown"}`,
		`elementModes=${modes}`,
		`retryable=${summary.retryable ? "true" : "false"}`
	];
	return [
		errorMessages.visionProxyFailed,
		renderProxyDebugDetails("视觉代理调试 · 执行失败", lines)
	].join("\n");
}

function renderProxyDebugDetails(summary: string, lines: string[]): string {
	return [
		`\`\`\`[Vision Debug] ${summary}`,
		...lines,
		"```",
		""
	].join("\n");
}
