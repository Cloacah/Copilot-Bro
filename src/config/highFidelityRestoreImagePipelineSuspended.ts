import type { VisionHandoffIntent } from "../visionProtocol/visionHandoffIntent";

/**
 * When true:
 * - **Still on**: structured proxy contract v3 (`elements[]`, `bbox`, `imageParams`, `svgParams` incl. fill/stroke),
 *   `vision.proxy.structured`, `normalizedProxySnapshot`, evidence/task stack (describe + complete only).
 * - **Off**: plan-driven raster/SVG/matting/vectorize post-processing (`executeProxyPlan` image work),
 *   workspace `vision-artifacts/` PNG/SVG persistence, Phase 1 restore pipeline UI knobs, and restore-only tests.
 * Flip to false to re-enable full restore post-processing and related Host UI restore markers.
 */
export const HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED = true;

/** Single gate for raster/SVG post-processing and on-disk vision artifacts. */
export function isStructuredVisionImageOutputEnabled(handoffIntent: VisionHandoffIntent): boolean {
	return !HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED && handoffIntent === "restore-artifact";
}

export function shouldPersistVisionImageArtifactsFromExecution(
	handoffIntent: VisionHandoffIntent,
	execution?: {
		readonly svgOutputs?: readonly unknown[];
		readonly processedImageParts?: readonly unknown[];
	}
): boolean {
	if (!isStructuredVisionImageOutputEnabled(handoffIntent)) {
		return false;
	}
	return Boolean(execution?.svgOutputs?.length || execution?.processedImageParts?.length);
}
