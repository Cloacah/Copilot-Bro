/**
 * When true:
 * - **Still on**: structured proxy contract v3 (`elements[]`, `bbox`, `imageParams`, `svgParams` incl. fill/stroke),
 *   `vision.proxy.structured`, `normalizedProxySnapshot`, evidence/task stack, describe-only paths.
 * - **Off**: plan-driven raster/SVG/matting/vectorize post-processing (`executeProxyPlan` image work),
 *   Phase 1 restore pipeline UI knobs (svgOptimize, rasterVectorize, …), and restore-pipeline-only automated tests.
 * Flip to false to re-enable full restore post-processing and related Host UI restore markers.
 */
export const HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED = true;
