/**
 * Shared JSON extraction for vision model outputs (proxy contract + native VisionBatchResult).
 */

export interface VisionJsonExtractResult {
	value: unknown;
	repaired: boolean;
}

export function extractJsonObjectFromVisionText(raw: string): VisionJsonExtractResult | undefined {
	const trimmed = raw.trim();
	if (!trimmed) {
		return undefined;
	}
	const direct = safeJsonParse(trimmed);
	if (direct && typeof direct === "object") {
		return { value: direct, repaired: false };
	}
	const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
	if (fenceMatch?.[1]) {
		const fenced = parseWithOptionalRepair(fenceMatch[1].trim());
		if (fenced) {
			return fenced;
		}
	}
	const first = trimmed.indexOf("{");
	const last = trimmed.lastIndexOf("}");
	if (first >= 0 && last > first) {
		const sliced = parseWithOptionalRepair(trimmed.slice(first, last + 1));
		if (sliced) {
			return sliced;
		}
	}
	for (let scan = 0; ; ) {
		const open = trimmed.indexOf("{", scan);
		if (open < 0) {
			break;
		}
		const balanced = extractFirstBalancedJsonObject(trimmed, open);
		if (balanced) {
			const balancedParsed = parseWithOptionalRepair(balanced);
			if (balancedParsed) {
				return balancedParsed;
			}
		}
		scan = open + 1;
	}
	return undefined;
}

function parseWithOptionalRepair(input: string): VisionJsonExtractResult | undefined {
	const direct = safeJsonParse(input);
	if (direct && typeof direct === "object") {
		return { value: direct, repaired: false };
	}
	for (const candidate of buildJsonRepairCandidates(input)) {
		const parsed = safeJsonParse(candidate);
		if (parsed && typeof parsed === "object") {
			return { value: parsed, repaired: candidate !== input };
		}
	}
	return undefined;
}

function buildJsonRepairCandidates(input: string): string[] {
	const trimmed = input.trim();
	const candidates: string[] = [];
	const push = (text: string) => {
		const normalized = text.trim();
		if (normalized && !candidates.includes(normalized)) {
			candidates.push(normalized);
		}
	};
	push(trimmed);
	push(repairCommonJsonDefects(trimmed));
	push(repairUnbalancedJsonBrackets(trimmed));
	push(repairCommonJsonDefects(repairUnbalancedJsonBrackets(trimmed)));
	return candidates;
}

/** Lightweight repairs (no extra dependency): trailing commas, strip BOM. */
export function repairCommonJsonDefects(input: string): string {
	let text = input.replace(/^\uFEFF/u, "").trim();
	text = text.replace(/,\s*([}\]])/gu, "$1");
	return text;
}

/** Close unmatched `{` / `[` outside JSON strings (limited auto-repair for truncated model output). */
export function repairUnbalancedJsonBrackets(input: string): string {
	let depthCurly = 0;
	let depthSquare = 0;
	let inString = false;
	let escape = false;
	for (let i = 0; i < input.length; i++) {
		const c = input[i];
		if (escape) {
			escape = false;
			continue;
		}
		if (inString) {
			if (c === "\\") {
				escape = true;
				continue;
			}
			if (c === '"') {
				inString = false;
			}
			continue;
		}
		if (c === '"') {
			inString = true;
			continue;
		}
		if (c === "{") {
			depthCurly++;
			continue;
		}
		if (c === "}") {
			if (depthCurly > 0) {
				depthCurly--;
			}
			continue;
		}
		if (c === "[") {
			depthSquare++;
			continue;
		}
		if (c === "]") {
			if (depthSquare > 0) {
				depthSquare--;
			}
		}
	}
	let suffix = "";
	while (depthSquare > 0) {
		suffix += "]";
		depthSquare--;
	}
	while (depthCurly > 0) {
		suffix += "}";
		depthCurly--;
	}
	return suffix.length > 0 ? `${input}${suffix}` : input;
}

function extractFirstBalancedJsonObject(text: string, openBraceIndex: number): string | undefined {
	let depth = 0;
	let inString = false;
	let escape = false;
	let start = -1;
	for (let i = openBraceIndex; i < text.length; i++) {
		const c = text[i];
		if (escape) {
			escape = false;
			continue;
		}
		if (inString) {
			if (c === "\\") {
				escape = true;
				continue;
			}
			if (c === '"') {
				inString = false;
			}
			continue;
		}
		if (c === '"') {
			inString = true;
			continue;
		}
		if (c === "{") {
			if (depth === 0) {
				start = i;
			}
			depth++;
			continue;
		}
		if (c === "}" && depth > 0) {
			depth--;
			if (depth === 0 && start >= 0) {
				return text.slice(start, i + 1);
			}
		}
	}
	return undefined;
}

function safeJsonParse(input: string): unknown {
	try {
		return JSON.parse(input);
	} catch {
		return undefined;
	}
}
