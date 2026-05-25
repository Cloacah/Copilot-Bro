/**
 * Canonical vision / provider log event names (substring markers for Host UI smoke and replay tests).
 */
export const VisionLogEvent = {
	inputBound: "vision.input.bound",
	routeSelected: "vision.route.selected",
	proxySelected: "vision.proxy.selected",
	proxyCacheHit: "vision.proxy.cache.hit",
	proxyCacheMiss: "vision.proxy.cache.miss",
	proxyHydratedImagePaths: "vision.proxy.hydrated.imagePaths",
	handoffResolved: "vision.handoff.resolved",
	evidencePersisted: "vision.evidence.persisted",
	evidenceNativeCompleted: "vision.evidence.native.completed",
	restorePipelineSkipped: "vision.restore.pipeline.skipped",
	restorePipelineStart: "vision.restore.pipeline.start",
	restorePipelineComplete: "vision.restore.pipeline.complete",
	rasterVectorize: "vision.raster.vectorize",
	restoreFidelityReport: "vision.restore.fidelity.report",
	nativeStructuredResolving: "vision.native.structured.resolving",
	nativeStructured: "vision.native.structured",
	nativeStructuredCompleted: "vision.native.structured.completed",
	nativeCacheHit: "vision.native.cache.hit",
	nativeCacheMiss: "vision.native.cache.miss",
	nativeStructuredPass: "vision.native.structured.pass",
	guardResidualImages: "vision.guard.residual-images",
	roiConfidenceBlocked: "vision.roi.confidence.blocked",
	roiTimeout: "vision.roi.timeout",
	artifactPersistFailed: "vision.artifact.persist.failed",
	imagePipelineSuspended: "image-pipeline-suspended"
} as const;

export const ProviderLogEvent = {
	requestStart: "request.start",
	requestEnd: "request.end",
	requestRetry: "request.retry",
	requestMessagesSummary: "request.messages.summary"
} as const;

/** JSON/log tail substrings used in Host UI integration marker checks. */
export const LogMarkerSnippet = {
	hasImagePartsFalse: '"hasImageParts":false',
	rawImageForwardedFalse: '"rawImageForwarded":false',
	strategyNative: '"strategy":"native"',
	strategyProxy: '"strategy":"proxy"',
	selectionExtensionConfigured: '"selection":"extension-configured"',
	selectionFallbackSelected: '"selection":"fallback-selected"',
	reasonSelfDisabled: '"reason":"self-disabled"',
	passedTrue: '"passed":true',
	skippedTrue: '"skipped":true',
	providerZhipu: '"provider":"zhipu"',
	providerMinimax: '"provider":"minimax"',
	providerKimi: '"provider":"kimi"'
} as const;

export type VisionLogEventName = (typeof VisionLogEvent)[keyof typeof VisionLogEvent];
