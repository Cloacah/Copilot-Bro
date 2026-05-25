export interface SvgStyleFidelitySummary {
	sourceTokenCount: number;
	resultTokenCount: number;
	preservedTokenCount: number;
	fidelityScore: number;
	preservedTokens: string[];
	warnings: string[];
}

const STYLE_ATTRS = [
	"fill",
	"stroke",
	"opacity",
	"fill-opacity",
	"stroke-opacity",
	"stroke-width",
	"font-family",
	"font-size",
	"clip-path",
	"mask",
	"filter",
	"gradientTransform",
	"stop-color"
] as const;

export function evaluateSvgStyleFidelity(originalSvg: string, resultSvg: string): SvgStyleFidelitySummary {
	const sourceTokens = extractStyleTokens(originalSvg);
	const resultTokens = extractStyleTokens(resultSvg);
	const preservedTokens = [...sourceTokens].filter((token) => resultTokens.has(token)).sort();
	const fidelityScore = sourceTokens.size === 0 ? 1 : clamp01(preservedTokens.length / sourceTokens.size);
	const warnings: string[] = [];
	if (preservedTokens.length < sourceTokens.size) {
		warnings.push(`svgStyle:preserved_${preservedTokens.length}_of_${sourceTokens.size}`);
	}

	return {
		sourceTokenCount: sourceTokens.size,
		resultTokenCount: resultTokens.size,
		preservedTokenCount: preservedTokens.length,
		fidelityScore,
		preservedTokens,
		warnings
	};
}

function extractStyleTokens(svg: string): Set<string> {
	const tokens = new Set<string>();
	for (const attr of STYLE_ATTRS) {
		const regex = new RegExp(`\\b${escapeRegExp(attr)}=(["'])(.*?)\\1`, "gi");
		let match: RegExpExecArray | null;
		while ((match = regex.exec(svg)) !== null) {
			tokens.add(`${attr}=${normalizeTokenValue(match[2])}`);
		}
	}

	const styleRegex = /\bstyle=(["'])(.*?)\1/gi;
	let styleMatch: RegExpExecArray | null;
	while ((styleMatch = styleRegex.exec(svg)) !== null) {
		for (const declaration of styleMatch[2].split(";")) {
			const [rawName, ...rawValueParts] = declaration.split(":");
			if (!rawName || rawValueParts.length === 0) {
				continue;
			}
			const name = rawName.trim();
			if (!STYLE_ATTRS.includes(name as (typeof STYLE_ATTRS)[number])) {
				continue;
			}
			const value = rawValueParts.join(":").trim();
			tokens.add(`${name}=${normalizeTokenValue(value)}`);
		}
	}
	return tokens;
}

function normalizeTokenValue(value: string): string {
	const trimmed = value.replace(/\s+/g, " ").trim();
	if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? String(parsed) : trimmed;
	}
	return trimmed;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}