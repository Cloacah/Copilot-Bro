/**
 * Production vision route order (SSOT for docs/plan alignment).
 * @see docs/vision-route-order.md
 */
export const VISION_ROUTE_PIPELINE_STAGES = [
	"processing-and-integrity",
	"roi-gate-pre-route",
	"tool-select-route",
	"strategy-branch",
	"proxy-or-native-resolution",
	"roi-gate-post-proxy",
	"residual-image-guard"
] as const;

export type VisionRoutePipelineStage = (typeof VISION_ROUTE_PIPELINE_STAGES)[number];
