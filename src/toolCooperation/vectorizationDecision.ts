import type { RasterPolicy, SvgDecisionPolicy } from "../types";

export interface VectorizationDecisionInput {
	hasSvgInput: boolean;
	hasRasterImage: boolean;
	svgOptimizeEnabled: boolean;
	mlSegmentEnabled: boolean;
	rasterVectorizeEnabled?: boolean;
	svgDecisionPolicy?: SvgDecisionPolicy;
	rasterPolicy?: RasterPolicy;
}

export interface VectorizationDecisionResult {
	preferSvgRoute: boolean;
	shouldOptimizeSvg: boolean;
	shouldRunRasterPath: boolean;
	shouldRunMlSegment: boolean;
	shouldRunRasterVectorize: boolean;
	route: "svg" | "raster" | "none";
}

export function decideVectorizationRoute(input: VectorizationDecisionInput): VectorizationDecisionResult {
	const svgPolicy = normalizeSvgPolicy(input.svgDecisionPolicy);
	const rasterPolicy = normalizeRasterPolicy(input.rasterPolicy);

	const preferSvgRoute = resolveSvgPreference(input.hasSvgInput, input.hasRasterImage, svgPolicy);
	const shouldOptimizeSvg = input.hasSvgInput && input.svgOptimizeEnabled && preferSvgRoute;
	const shouldRunRasterPath = resolveRasterPath(input.hasRasterImage, preferSvgRoute, rasterPolicy);
	const shouldRunMlSegment = shouldRunRasterPath && input.mlSegmentEnabled;
	const shouldRunRasterVectorize = Boolean(
		input.hasRasterImage
		&& input.rasterVectorizeEnabled !== false
		&& (!input.hasSvgInput || svgPolicy === "always")
	);

	let route: VectorizationDecisionResult["route"] = "none";
	if (preferSvgRoute && input.hasSvgInput) {
		route = "svg";
	} else if (shouldRunRasterPath) {
		route = "raster";
	}

	return {
		preferSvgRoute,
		shouldOptimizeSvg,
		shouldRunRasterPath,
		shouldRunMlSegment,
		shouldRunRasterVectorize,
		route
	};
}

function resolveSvgPreference(hasSvgInput: boolean, hasRasterImage: boolean, policy: SvgDecisionPolicy): boolean {
	if (policy === "always") {
		return hasSvgInput;
	}
	if (policy === "never") {
		return false;
	}
	if (hasSvgInput) {
		return true;
	}
	return !hasRasterImage && hasSvgInput;
}

function resolveRasterPath(hasRasterImage: boolean, preferSvgRoute: boolean, policy: RasterPolicy): boolean {
	if (!hasRasterImage) {
		return false;
	}
	if (policy === "skip") {
		return false;
	}
	if (policy === "segment") {
		return true;
	}
	return !preferSvgRoute;
}

function normalizeSvgPolicy(value: SvgDecisionPolicy | undefined): SvgDecisionPolicy {
	if (value === "always" || value === "never" || value === "auto") {
		return value;
	}
	return "auto";
}

function normalizeRasterPolicy(value: RasterPolicy | undefined): RasterPolicy {
	if (value === "segment" || value === "skip" || value === "auto") {
		return value;
	}
	return "auto";
}
