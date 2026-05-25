export interface SvgStructureValidationSummary {
	valid: boolean;
	hasRoot: boolean;
	hasViewBox: boolean;
	pathCount: number;
	warnings: string[];
}

export function validateSvgStructure(svg: string): SvgStructureValidationSummary {
	const hasRoot = /<svg\b/i.test(svg) && /<\/svg>/i.test(svg);
	const hasViewBox = /\bviewBox=(["']).*?\1/i.test(svg);
	const pathCount = (svg.match(/<path\b/gi) ?? []).length;
	const warnings: string[] = [];

	if (!hasRoot) {
		warnings.push("svgStructure:missing_root");
	}
	if (!hasViewBox) {
		warnings.push("svgStructure:missing_viewBox");
	}
	if (pathCount === 0) {
		warnings.push("svgStructure:missing_path");
	}

	return {
		valid: warnings.length === 0,
		hasRoot,
		hasViewBox,
		pathCount,
		warnings
	};
}