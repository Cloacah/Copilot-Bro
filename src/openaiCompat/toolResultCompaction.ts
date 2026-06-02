/**
 * Compacts oversized tool/terminal results before they enter model context.
 * Preserves actionable signal (errors, exit codes, head/tail) so agent behavior stays reliable.
 */

export interface ToolResultCompactionOptions {
	/** Only compact when raw text exceeds this length. Default 4500. */
	readonly minCharsToCompact?: number;
	/** Hard cap on compacted output length. Default 14000. */
	readonly maxChars?: number;
	readonly headLines?: number;
	readonly tailLines?: number;
}

export interface ToolResultCompactionResult {
	readonly text: string;
	readonly compacted: boolean;
	readonly originalChars: number;
	readonly originalLines: number;
	readonly omittedLineCount: number;
}

const DEFAULT_MIN_CHARS = 4500;
const DEFAULT_MAX_CHARS = 14_000;
const DEFAULT_HEAD_LINES = 32;
const DEFAULT_TAIL_LINES = 96;

const SIGNAL_LINE =
	/(?:\berror\b|\bfailed\b|\bfailure\b|\bexception\b|\btraceback\b|\bassert(?:ion)?\b|\bfatal\b|\bpanic\b|npm ERR!|TS\d{4,5}\b|exit code|Exit code|ERROR:|WARN:|Unhandled|Segmentation fault|CS\d{4}|UnityEngine\.)/i;

/** Keep intact JSON tool payloads below this size so structured tools keep working. */
const MAX_PRESERVED_JSON_CHARS = 48_000;

const CONTEXT_NOTE =
	"[Copilot Bro] Tool output was compacted for context length. " +
	"Critical errors and the most recent output are preserved below; " +
	"the full output remains visible in the Copilot tool/terminal UI.";

const recentCompactionEvents: ToolResultCompactionResult[] = [];

/** Drain compaction events since last drain (for request-level logging). */
export function drainToolResultCompactionEvents(): readonly ToolResultCompactionResult[] {
	if (recentCompactionEvents.length === 0) {
		return [];
	}
	const drained = [...recentCompactionEvents];
	recentCompactionEvents.length = 0;
	return drained;
}

export function isToolResultCompactionDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const flag = env.COPILOT_BRO_TOOL_RESULT_COMPACT?.trim().toLowerCase();
	return flag === "0" || flag === "false" || flag === "off";
}

/**
 * Structured tool payloads (valid JSON object/array) are passed through verbatim when small enough
 * so providers (DeepSeek, Zhipu, Kimi, Qwen, etc.) can parse tool results normally.
 */
export function shouldPreserveToolResultVerbatim(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed || trimmed.length > MAX_PRESERVED_JSON_CHARS) {
		return false;
	}
	const first = trimmed[0];
	const last = trimmed[trimmed.length - 1];
	if ((first === "{" && last === "}") || (first === "[" && last === "]")) {
		try {
			JSON.parse(trimmed);
			return true;
		} catch {
			return false;
		}
	}
	return false;
}

export function compactToolResultText(
	raw: string,
	options: ToolResultCompactionOptions = {}
): ToolResultCompactionResult {
	const input = raw ?? "";
	const originalChars = input.length;
	const lines = input.split(/\r?\n/u);
	const originalLines = lines.length;
	const minChars = options.minCharsToCompact ?? DEFAULT_MIN_CHARS;
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	const headLines = options.headLines ?? DEFAULT_HEAD_LINES;
	const tailLines = options.tailLines ?? DEFAULT_TAIL_LINES;

	if (originalChars <= minChars || shouldPreserveToolResultVerbatim(input)) {
		return {
			text: input,
			compacted: false,
			originalChars,
			originalLines,
			omittedLineCount: 0
		};
	}

	const deduped = collapseConsecutiveDuplicateLines(lines);
	const signalIndices = collectSignalLineIndices(deduped);
	const head = deduped.slice(0, headLines);
	const tail = deduped.slice(Math.max(head.length, deduped.length - tailLines));
	const signalLines = signalIndices
		.filter((index) => index >= head.length && index < deduped.length - tail.length)
		.map((index) => deduped[index]!);

	const middleOmitted = Math.max(0, deduped.length - head.length - tail.length - signalLines.length);
	const sections: string[] = [CONTEXT_NOTE];
	if (signalLines.length > 0) {
		sections.push("", "--- signal lines (errors / warnings / exit) ---", ...signalLines);
	}
	sections.push("", "--- output head ---", ...head);
	if (middleOmitted > 0) {
		sections.push("", `--- omitted ${middleOmitted} middle line(s); see Terminal for full log ---`, "");
	}
	sections.push("--- output tail ---", ...tail);

	let text = sections.join("\n");
	if (text.length > maxChars) {
		text = shrinkToMaxChars(maxChars, signalLines, tail);
	}

	const result: ToolResultCompactionResult = {
		text,
		compacted: true,
		originalChars,
		originalLines,
		omittedLineCount: Math.max(0, originalLines - deduped.length) + middleOmitted
	};
	recentCompactionEvents.push(result);
	return result;
}

function collapseConsecutiveDuplicateLines(lines: readonly string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		let repeat = 1;
		while (i + 1 < lines.length && lines[i + 1] === line) {
			repeat++;
			i++;
		}
		if (repeat > 1 && line.trim()) {
			out.push(`${line}  (repeated ${repeat}×)`);
		} else {
			for (let j = 0; j < repeat; j++) {
				out.push(line);
			}
		}
	}
	return out;
}

function collectSignalLineIndices(lines: readonly string[]): number[] {
	const indices: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (SIGNAL_LINE.test(lines[i]!)) {
			indices.push(i);
		}
	}
	return indices;
}

function shrinkToMaxChars(maxChars: number, signalLines: readonly string[], tail: readonly string[]): string {
	const sections = [CONTEXT_NOTE];
	if (signalLines.length > 0) {
		sections.push("", "--- signal lines (errors / warnings / exit) ---", ...signalLines);
	}
	sections.push("", "--- output tail ---", ...tail);
	const text = sections.join("\n");
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, maxChars - 1)}…`;
}
