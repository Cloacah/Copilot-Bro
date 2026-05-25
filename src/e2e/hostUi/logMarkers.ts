import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../../config/highFidelityRestoreImagePipelineSuspended";
import { LogMarkerSnippet, ProviderLogEvent, VisionLogEvent } from "../../visionProtocol/visionLogEvents";

export { LogMarkerSnippet, ProviderLogEvent, VisionLogEvent };

export type HostUiSmokeChatPlanPhase = "p3" | "p4" | "p5" | "p6" | "p7";

/** Minimum markers any scenario tagged with a phase should include in its own requiredLogMarkers. */
export const PLAN_PHASE_REQUIRED_CHAT_LOG_MARKERS: Readonly<Record<HostUiSmokeChatPlanPhase, readonly string[]>> = {
	p3: [VisionLogEvent.inputBound, VisionLogEvent.routeSelected],
	p4: [],
	p5: [ProviderLogEvent.requestStart, ProviderLogEvent.requestEnd],
	p6: [VisionLogEvent.evidencePersisted],
	p7: [VisionLogEvent.evidencePersisted, VisionLogEvent.handoffResolved]
} as const;

export const P7_RESTORE_ARTIFACT_CHAT_MARKERS: readonly string[] = HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED
	? [
		VisionLogEvent.inputBound,
		VisionLogEvent.handoffResolved,
		VisionLogEvent.proxyCacheMiss,
		VisionLogEvent.evidencePersisted,
		VisionLogEvent.routeSelected,
		VisionLogEvent.restorePipelineSkipped,
		VisionLogEvent.imagePipelineSuspended,
		LogMarkerSnippet.hasImagePartsFalse,
		ProviderLogEvent.requestEnd
	]
	: [
		VisionLogEvent.inputBound,
		VisionLogEvent.handoffResolved,
		VisionLogEvent.rasterVectorize,
		VisionLogEvent.restoreFidelityReport,
		VisionLogEvent.restorePipelineStart,
		VisionLogEvent.restorePipelineComplete,
		VisionLogEvent.evidencePersisted,
		VisionLogEvent.routeSelected,
		VisionLogEvent.proxyCacheMiss,
		LogMarkerSnippet.hasImagePartsFalse,
		LogMarkerSnippet.passedTrue,
		ProviderLogEvent.requestEnd
	];

export const P7_RESTORE_ARTIFACT_CHAT_FORBIDDEN: readonly string[] = HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED
	? [VisionLogEvent.artifactPersistFailed]
	: [VisionLogEvent.artifactPersistFailed, VisionLogEvent.restorePipelineSkipped];

export const P7_CHAT_BENCHMARK_MARKERS: readonly string[] = HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED
	? [
		VisionLogEvent.inputBound,
		VisionLogEvent.handoffResolved,
		VisionLogEvent.evidencePersisted,
		VisionLogEvent.routeSelected,
		VisionLogEvent.proxyCacheMiss,
		VisionLogEvent.restorePipelineSkipped,
		VisionLogEvent.imagePipelineSuspended,
		"host-ui-smoke.chat.benchmark.page-ssim",
		LogMarkerSnippet.skippedTrue,
		ProviderLogEvent.requestEnd,
		LogMarkerSnippet.hasImagePartsFalse
	]
	: [
		VisionLogEvent.inputBound,
		VisionLogEvent.handoffResolved,
		VisionLogEvent.evidencePersisted,
		VisionLogEvent.routeSelected,
		VisionLogEvent.proxyCacheMiss,
		VisionLogEvent.restorePipelineStart,
		VisionLogEvent.restorePipelineComplete,
		"host-ui-smoke.chat.benchmark.page-ssim.capture",
		"host-ui-smoke.chat.benchmark.page-ssim",
		LogMarkerSnippet.passedTrue,
		ProviderLogEvent.requestEnd,
		LogMarkerSnippet.hasImagePartsFalse
	];

export const P7_CHAT_BENCHMARK_FORBIDDEN: readonly string[] = HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED
	? []
	: [VisionLogEvent.restorePipelineSkipped];

/** Extra markers required for specific scenario ids (cache hit vs miss, raw-image guard, native route). */
export const CHAT_INTEGRATION_SCENARIO_EXTRA_MARKERS: Readonly<Record<string, readonly string[]>> = {
	"p3-global-qwen-proxy-chat": [
		LogMarkerSnippet.selectionExtensionConfigured,
		VisionLogEvent.proxySelected,
		'"provider":"qwen"',
		VisionLogEvent.proxyCacheMiss
	],
	"vision-proxy-miss": [
		VisionLogEvent.proxyCacheMiss,
		LogMarkerSnippet.hasImagePartsFalse,
		LogMarkerSnippet.rawImageForwardedFalse
	],
	"vision-proxy-cache-hit": [VisionLogEvent.proxyCacheHit],
	"p5-qwen-vl-native-chat": [
		LogMarkerSnippet.strategyNative,
		VisionLogEvent.nativeStructuredResolving,
		LogMarkerSnippet.hasImagePartsFalse
	],
	"p4-self-refer-proxy-chat": [LogMarkerSnippet.reasonSelfDisabled, VisionLogEvent.guardResidualImages],
	"p4-wrapped-vision-chat": ["vscode-lm::"],
	"p6-path-hydration-chat": [VisionLogEvent.proxyHydratedImagePaths, VisionLogEvent.proxyCacheMiss],
	"p7-restore-artifact-chat": [...P7_RESTORE_ARTIFACT_CHAT_MARKERS],
	"p7-chat-benchmark-web-restore": [...P7_CHAT_BENCHMARK_MARKERS],
	"native-vision-zhipu-chat": [
		LogMarkerSnippet.strategyNative,
		VisionLogEvent.nativeStructuredResolving,
		VisionLogEvent.nativeStructuredCompleted,
		LogMarkerSnippet.hasImagePartsFalse
	],
	"multi-provider-switch-context": [VisionLogEvent.inputBound, ProviderLogEvent.requestEnd]
} as const;
