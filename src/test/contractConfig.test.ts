import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	DEFAULT_REQUEST_ATTRIBUTION,
	DEFAULT_VISION_AGENT,
	DEFAULT_VISION_INTEGRITY,
	DEFAULT_VISION_PROCESSING,
	PHASE1_NORMALIZER_INPUT_KEYS,
	createObjectConfigReader,
	getNormalizedRequestAttributionConfig,
	getNormalizedVisionAgentConfig,
	getNormalizedVisionIntegrityConfig,
	getNormalizedVisionProcessingConfig
} from "../config/contractConfig";

function loadConfigurationProperties(): Record<string, any> {
	const packageJsonPath = path.join(process.cwd(), "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
		contributes?: {
			configuration?: {
				properties?: Record<string, any>;
			};
		};
	};
	return packageJson.contributes?.configuration?.properties ?? {};
}

test("visionAgent clamps keepAliveMs and batch sizes to contract bounds", () => {
	assert.equal(getNormalizedVisionAgentConfig(createObjectConfigReader({
		visionAgent: { keepAliveMs: -1 }
	})).keepAliveMs, 0);
	assert.equal(getNormalizedVisionAgentConfig(createObjectConfigReader({
		visionAgent: { keepAliveMs: 0 }
	})).keepAliveMs, 0);
	assert.equal(getNormalizedVisionAgentConfig(createObjectConfigReader({
		visionAgent: { keepAliveMs: 120000 }
	})).keepAliveMs, 120000);
	assert.equal(getNormalizedVisionAgentConfig(createObjectConfigReader({
		visionAgent: { keepAliveMs: 600001 }
	})).keepAliveMs, 600000);

	assert.equal(getNormalizedVisionAgentConfig(createObjectConfigReader({
		visionAgent: { maxBatchSize: 0 }
	})).maxBatchSize, 1);
	assert.equal(getNormalizedVisionAgentConfig(createObjectConfigReader({
		visionAgent: { maxBatchSize: 6 }
	})).maxBatchSize, 6);
	assert.equal(getNormalizedVisionAgentConfig(createObjectConfigReader({
		visionAgent: { maxBatchSize: 20 }
	})).maxBatchSize, 20);
	assert.equal(getNormalizedVisionAgentConfig(createObjectConfigReader({
		visionAgent: { maxBatchSize: 21 }
	})).maxBatchSize, 20);
});

test("Phase 1 aliases and legacy fields preserve semantics after normalization", () => {
	const visionAgent = getNormalizedVisionAgentConfig(createObjectConfigReader({
		visionEnabled: true,
		visionAgent: {
			dedupeByHash: false,
			autoClosePolicy: "timeout"
		}
	}));
	assert.equal(visionAgent.enabled, true);
	assert.equal(visionAgent.deduplicateImages, false);
	assert.equal(visionAgent.dedupeByHash, false);
	assert.equal(visionAgent.autoClosePolicy, "afterTimeout");

	const invalidPolicy = getNormalizedVisionAgentConfig(createObjectConfigReader({
		visionAgent: {
			autoClosePolicy: "invalidValue"
		}
	}));
	assert.equal(invalidPolicy.autoClosePolicy, "afterMainTask");

	const visionProcessing = getNormalizedVisionProcessingConfig(createObjectConfigReader({
		visionProcessing: {
			chatDebugVisibility: false,
			tokenBudgetMode: "verbose"
		}
	}));
	assert.equal(visionProcessing.outputVerbosity, "verbose");
	assert.equal(visionProcessing.tokenBudgetMode, "verbose");
	assert.equal(visionProcessing.chatDebugVisibility, false);
});

test("visionIntegrity, modelCompatibility, and requestAttribution normalize defaults and runtime fields", () => {
	const visionIntegrity = getNormalizedVisionIntegrityConfig(createObjectConfigReader({
		visionIntegrity: {
			strictIntegrity: true,
			certaintyThreshold: 1.6,
			tileMaxPixels: 20_000_000,
			roiMode: "smart",
			detailPriority: "low"
		}
	}));
	assert.equal(visionIntegrity.strictIntegrity, true);
	assert.equal(visionIntegrity.certaintyThreshold, 1);
	assert.equal(visionIntegrity.tileMaxPixels, 16_777_216);
	assert.equal(visionIntegrity.roiMode, "smart");
	assert.equal(visionIntegrity.detailPriority, "low");


	const requestAttribution = getNormalizedRequestAttributionConfig(createObjectConfigReader({
		requestAttribution: {
			enabled: true
		}
	}));
	assert.deepEqual(requestAttribution, {
		...DEFAULT_REQUEST_ATTRIBUTION,
		enabled: true
	});
});

test("package schema declares all Phase 1 contract groups and aligns defaults", () => {
	const properties = loadConfigurationProperties();
	const requiredKeys = [
		"extendedModels.visionAgent",
		"extendedModels.visionIntegrity",
		"extendedModels.visionProcessing",
		"extendedModels.requestAttribution"
	];
	for (const key of requiredKeys) {
		assert.ok(properties[key], `missing schema property: ${key}`);
	}

	assert.deepEqual(properties["extendedModels.visionAgent"].default, {
		enabled: DEFAULT_VISION_AGENT.enabled,
		keepAliveMs: DEFAULT_VISION_AGENT.keepAliveMs,
		maxBatchSize: DEFAULT_VISION_AGENT.maxBatchSize,
		maxConcurrentBatches: DEFAULT_VISION_AGENT.maxConcurrentBatches,
		resetContextPerBatch: DEFAULT_VISION_AGENT.resetContextPerBatch,
		deduplicateImages: DEFAULT_VISION_AGENT.deduplicateImages,
		dedupeByHash: DEFAULT_VISION_AGENT.dedupeByHash,
		retryOnFailure: DEFAULT_VISION_AGENT.retryOnFailure,
		autoClosePolicy: DEFAULT_VISION_AGENT.autoClosePolicy
	});

	assert.deepEqual(properties["extendedModels.visionIntegrity"].default, {
		enabled: DEFAULT_VISION_INTEGRITY.enabled,
		strictIntegrity: DEFAULT_VISION_INTEGRITY.strictIntegrity,
		certaintyThreshold: DEFAULT_VISION_INTEGRITY.certaintyThreshold,
		checkCount: DEFAULT_VISION_INTEGRITY.checkCount,
		checkDimensions: DEFAULT_VISION_INTEGRITY.checkDimensions,
		checkDigest: DEFAULT_VISION_INTEGRITY.checkDigest,
		trackResize: DEFAULT_VISION_INTEGRITY.trackResize,
		trackByteSummary: DEFAULT_VISION_INTEGRITY.trackByteSummary,
		roiMode: DEFAULT_VISION_INTEGRITY.roiMode,
		tileMaxPixels: DEFAULT_VISION_INTEGRITY.tileMaxPixels,
		detailPriority: DEFAULT_VISION_INTEGRITY.detailPriority
	});

	assert.deepEqual(properties["extendedModels.visionProcessing"].default, {
		svgOptimize: DEFAULT_VISION_PROCESSING.svgOptimize,
		imagePreprocess: DEFAULT_VISION_PROCESSING.imagePreprocess,
		mlSegment: DEFAULT_VISION_PROCESSING.mlSegment,
		outputVerbosity: DEFAULT_VISION_PROCESSING.outputVerbosity,
		chatDebugVisibility: DEFAULT_VISION_PROCESSING.chatDebugVisibility,
		tokenBudgetMode: DEFAULT_VISION_PROCESSING.tokenBudgetMode,
		needVisionGate: DEFAULT_VISION_PROCESSING.needVisionGate,
		svgDecisionPolicy: DEFAULT_VISION_PROCESSING.svgDecisionPolicy,
		rasterPolicy: DEFAULT_VISION_PROCESSING.rasterPolicy,
		spatialSchemaVersion: DEFAULT_VISION_PROCESSING.spatialSchemaVersion,
		allowBBoxPlaceholderSvg: DEFAULT_VISION_PROCESSING.allowBBoxPlaceholderSvg,
		rasterVectorize: DEFAULT_VISION_PROCESSING.rasterVectorize
	});

	assert.deepEqual(properties["extendedModels.requestAttribution"].default, {
		enabled: DEFAULT_REQUEST_ATTRIBUTION.enabled,
		includeSessionId: DEFAULT_REQUEST_ATTRIBUTION.includeSessionId,
		includeBatchId: DEFAULT_REQUEST_ATTRIBUTION.includeBatchId
	});
});

test("package schema enums and bounds stay aligned with normalization rules", () => {
	const properties = loadConfigurationProperties();
	assert.deepEqual(properties["extendedModels.visionAgent"].properties.autoClosePolicy.enum, ["afterMainTask", "afterTimeout", "never"]);
	assert.equal(properties["extendedModels.visionAgent"].properties.keepAliveMs.minimum, 0);
	assert.equal(properties["extendedModels.visionAgent"].properties.keepAliveMs.maximum, 600000);
	assert.equal(properties["extendedModels.visionAgent"].properties.maxBatchSize.minimum, 1);
	assert.equal(properties["extendedModels.visionAgent"].properties.maxBatchSize.maximum, 20);
	assert.deepEqual(properties["extendedModels.visionIntegrity"].properties.roiMode.enum, ["full", "roi-split", "smart"]);
	assert.deepEqual(properties["extendedModels.visionIntegrity"].properties.detailPriority.enum, ["balanced", "high", "low"]);
	assert.equal(properties["extendedModels.visionIntegrity"].properties.certaintyThreshold.minimum, 0);
	assert.equal(properties["extendedModels.visionIntegrity"].properties.certaintyThreshold.maximum, 1);
	assert.equal(properties["extendedModels.visionIntegrity"].properties.tileMaxPixels.minimum, 1);
	assert.equal(properties["extendedModels.visionIntegrity"].properties.tileMaxPixels.maximum, 16777216);
	assert.deepEqual(properties["extendedModels.visionProcessing"].properties.outputVerbosity.enum, ["conservative", "balanced", "verbose"]);
	assert.equal(properties["extendedModels.visionProcessing"].properties.chatDebugVisibility.default, true);
	assert.deepEqual(properties["extendedModels.visionProcessing"].properties.tokenBudgetMode.enum, ["conservative", "balanced", "verbose"]);
	assert.deepEqual(properties["extendedModels.visionProcessing"].properties.svgDecisionPolicy.enum, ["auto", "always", "never"]);
	assert.deepEqual(properties["extendedModels.visionProcessing"].properties.rasterPolicy.enum, ["auto", "segment", "skip"]);
});

test("Phase 1 normalization inputs are either declared in schema or tracked as approved legacy aliases", () => {
	const properties = loadConfigurationProperties();
	const allowedLegacyInputs: Record<string, string[]> = {
		visionAgent: ["visionEnabled"],
		visionIntegrity: [],
		visionProcessing: [],
		requestAttribution: []
	};

	for (const [sectionKey, inputKeys] of Object.entries(PHASE1_NORMALIZER_INPUT_KEYS)) {
		const schemaProperties = properties[`extendedModels.${sectionKey}`].properties ?? {};
		const allowedLegacy = new Set(allowedLegacyInputs[sectionKey] ?? []);
		for (const inputKey of inputKeys) {
			assert.ok(
				inputKey in schemaProperties || allowedLegacy.has(inputKey),
				`${sectionKey}.${inputKey} is read by normalization but missing from schema and approved legacy aliases`
			);
		}
	}
});