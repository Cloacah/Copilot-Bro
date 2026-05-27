import type {
	RequestAttributionConfig,
	SvgDecisionPolicy,
	RasterPolicy,
	VisionAgentAutoClosePolicy,
	VisionAgentConfig,
	VisionDetailPriority,
	VisionIntegrityConfig,
	VisionOutputVerbosity,
	VisionProcessingConfig,
	VisionRoiMode
} from "../types";
import { buildVisionPromptContract } from "../toolCooperation/visionPromptContract";

export interface ConfigReader {
	get<T>(section: string, defaultValue?: T): T;
}

export const DEFAULT_VISION_AGENT: VisionAgentConfig = {
	enabled: true,
	keepAliveMs: 120000,
	maxBatchSize: 6,
	maxConcurrentBatches: 1,
	resetContextPerBatch: true,
	deduplicateImages: true,
	dedupeByHash: true,
	retryOnFailure: true,
	autoClosePolicy: "afterMainTask"
};

export const DEFAULT_VISION_INTEGRITY: VisionIntegrityConfig = {
	enabled: true,
	strictIntegrity: false,
	certaintyThreshold: 0.7,
	checkCount: true,
	checkDimensions: true,
	checkDigest: true,
	trackResize: true,
	trackByteSummary: true,
	roiMode: "full",
	tileMaxPixels: 4_194_304,
	detailPriority: "balanced"
};

export const DEFAULT_VISION_PROCESSING: VisionProcessingConfig = {
	svgOptimize: true,
	imagePreprocess: true,
	mlSegment: false,
	outputVerbosity: "balanced",
	chatDebugVisibility: false,
	tokenBudgetMode: "balanced",
	needVisionGate: true,
	svgDecisionPolicy: "auto",
	rasterPolicy: "auto",
	spatialSchemaVersion: "v1",
	highFidelityPrompt: buildVisionPromptContract("v1"),
	allowBBoxPlaceholderSvg: false,
	rasterVectorize: true,
	maxVectorizeEdgePx: 512
};

export const DEFAULT_REQUEST_ATTRIBUTION: RequestAttributionConfig = {
	enabled: true,
	includeSessionId: true,
	includeBatchId: true
};

export const PHASE1_NORMALIZER_INPUT_KEYS = {
	visionAgent: [
		"visionEnabled",
		"enabled",
		"keepAliveMs",
		"maxBatchSize",
		"maxConcurrentBatches",
		"resetContextPerBatch",
		"deduplicateImages",
		"dedupeByHash",
		"retryOnFailure",
		"autoClosePolicy"
	],
	visionIntegrity: [
		"enabled",
		"strictIntegrity",
		"certaintyThreshold",
		"checkCount",
		"checkDimensions",
		"checkDigest",
		"trackResize",
		"trackByteSummary",
		"roiMode",
		"tileMaxPixels",
		"detailPriority"
	],
	visionProcessing: [
		"svgOptimize",
		"imagePreprocess",
		"mlSegment",
		"outputVerbosity",
		"chatDebugVisibility",
		"tokenBudgetMode",
		"needVisionGate",
		"svgDecisionPolicy",
		"rasterPolicy",
		"spatialSchemaVersion",
		"allowBBoxPlaceholderSvg",
		"rasterVectorize"
	],
	requestAttribution: [
		"enabled",
		"includeSessionId",
		"includeBatchId"
	]
} as const;

export function createObjectConfigReader(values: Record<string, unknown>): ConfigReader {
	return {
		get<T>(section: string, defaultValue?: T): T {
			const value = values[section];
			return (value === undefined ? defaultValue : value) as T;
		}
	};
}

export function getNormalizedVisionAgentConfig(config: ConfigReader): VisionAgentConfig {
	const record = normalizeObject(config.get<unknown>("visionAgent", {}));
	const legacyEnabled = config.get<boolean>("visionEnabled");
	const dedupe = asBoolean(record.deduplicateImages ?? record.dedupeByHash, DEFAULT_VISION_AGENT.deduplicateImages);
	return {
		enabled: typeof legacyEnabled === "boolean" ? legacyEnabled : asBoolean(record.enabled, DEFAULT_VISION_AGENT.enabled),
		keepAliveMs: clampNumber(record.keepAliveMs, DEFAULT_VISION_AGENT.keepAliveMs, 0, 600000),
		maxBatchSize: clampNumber(record.maxBatchSize, DEFAULT_VISION_AGENT.maxBatchSize, 1, 20),
		maxConcurrentBatches: clampNumber(record.maxConcurrentBatches, DEFAULT_VISION_AGENT.maxConcurrentBatches, 1, 20),
		resetContextPerBatch: asBoolean(record.resetContextPerBatch, DEFAULT_VISION_AGENT.resetContextPerBatch),
		deduplicateImages: dedupe,
		dedupeByHash: dedupe,
		retryOnFailure: asBoolean(record.retryOnFailure, DEFAULT_VISION_AGENT.retryOnFailure),
		autoClosePolicy: normalizeAutoClosePolicy(record.autoClosePolicy)
	};
}

export function getNormalizedVisionIntegrityConfig(config: ConfigReader): VisionIntegrityConfig {
	const record = normalizeObject(config.get<unknown>("visionIntegrity", {}));
	return {
		enabled: asBoolean(record.enabled, DEFAULT_VISION_INTEGRITY.enabled),
		strictIntegrity: asBoolean(record.strictIntegrity, DEFAULT_VISION_INTEGRITY.strictIntegrity),
		certaintyThreshold: clampNumber(record.certaintyThreshold, DEFAULT_VISION_INTEGRITY.certaintyThreshold, 0, 1),
		checkCount: asBoolean(record.checkCount, DEFAULT_VISION_INTEGRITY.checkCount),
		checkDimensions: asBoolean(record.checkDimensions, DEFAULT_VISION_INTEGRITY.checkDimensions),
		checkDigest: asBoolean(record.checkDigest, DEFAULT_VISION_INTEGRITY.checkDigest),
		trackResize: asBoolean(record.trackResize, DEFAULT_VISION_INTEGRITY.trackResize),
		trackByteSummary: asBoolean(record.trackByteSummary, DEFAULT_VISION_INTEGRITY.trackByteSummary),
		roiMode: normalizeRoiMode(record.roiMode),
		tileMaxPixels: clampNumber(record.tileMaxPixels, DEFAULT_VISION_INTEGRITY.tileMaxPixels, 1, 16_777_216),
		detailPriority: normalizeDetailPriority(record.detailPriority)
	};
}

export function getNormalizedVisionProcessingConfig(config: ConfigReader): VisionProcessingConfig {
	const record = normalizeObject(config.get<unknown>("visionProcessing", {}));
	const verbosity = normalizeOutputVerbosity(record.outputVerbosity ?? record.tokenBudgetMode);
	const customHighFidelityPrompt = asString(record.highFidelityPrompt);
	return {
		svgOptimize: asBoolean(record.svgOptimize, DEFAULT_VISION_PROCESSING.svgOptimize),
		imagePreprocess: asBoolean(record.imagePreprocess, DEFAULT_VISION_PROCESSING.imagePreprocess),
		mlSegment: asBoolean(record.mlSegment, DEFAULT_VISION_PROCESSING.mlSegment),
		outputVerbosity: verbosity,
		chatDebugVisibility: asBoolean(record.chatDebugVisibility, DEFAULT_VISION_PROCESSING.chatDebugVisibility),
		tokenBudgetMode: verbosity,
		needVisionGate: asBoolean(record.needVisionGate, DEFAULT_VISION_PROCESSING.needVisionGate),
		svgDecisionPolicy: normalizeSvgDecisionPolicy(record.svgDecisionPolicy),
		rasterPolicy: normalizeRasterPolicy(record.rasterPolicy),
		spatialSchemaVersion: asString(record.spatialSchemaVersion) || DEFAULT_VISION_PROCESSING.spatialSchemaVersion,
		highFidelityPrompt: customHighFidelityPrompt || DEFAULT_VISION_PROCESSING.highFidelityPrompt,
		allowBBoxPlaceholderSvg: asBoolean(record.allowBBoxPlaceholderSvg, DEFAULT_VISION_PROCESSING.allowBBoxPlaceholderSvg ?? false),
		rasterVectorize: asBoolean(record.rasterVectorize, DEFAULT_VISION_PROCESSING.rasterVectorize ?? true)
	};
}
export function getNormalizedRequestAttributionConfig(config: ConfigReader): RequestAttributionConfig {
	const record = normalizeObject(config.get<unknown>("requestAttribution", {}));
	return {
		enabled: asBoolean(record.enabled, DEFAULT_REQUEST_ATTRIBUTION.enabled),
		includeSessionId: asBoolean(record.includeSessionId, DEFAULT_REQUEST_ATTRIBUTION.includeSessionId),
		includeBatchId: asBoolean(record.includeBatchId, DEFAULT_REQUEST_ATTRIBUTION.includeBatchId)
	};
}

function normalizeObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function asString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) {
		return fallback;
	}
	return Math.min(maximum, Math.max(minimum, numeric));
}

function normalizeAutoClosePolicy(value: unknown): VisionAgentAutoClosePolicy {
	switch (value) {
		case "afterTimeout":
		case "timeout":
			return "afterTimeout";
		case "never":
		case "manual":
			return "never";
		case "afterMainTask":
			return "afterMainTask";
		default:
			return DEFAULT_VISION_AGENT.autoClosePolicy;
	}
}

function normalizeRoiMode(value: unknown): VisionRoiMode {
	return value === "roi-split" || value === "smart" ? value : DEFAULT_VISION_INTEGRITY.roiMode;
}

function normalizeDetailPriority(value: unknown): VisionDetailPriority {
	return value === "high" || value === "low" ? value : DEFAULT_VISION_INTEGRITY.detailPriority;
}

function normalizeOutputVerbosity(value: unknown): VisionOutputVerbosity {
	return value === "conservative" || value === "verbose" ? value : DEFAULT_VISION_PROCESSING.outputVerbosity;
}

function normalizeSvgDecisionPolicy(value: unknown): SvgDecisionPolicy {
	return value === "always" || value === "never" ? value : DEFAULT_VISION_PROCESSING.svgDecisionPolicy;
}

function normalizeRasterPolicy(value: unknown): RasterPolicy {
	return value === "segment" || value === "skip" ? value : DEFAULT_VISION_PROCESSING.rasterPolicy;
}