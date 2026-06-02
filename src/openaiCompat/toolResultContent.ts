/**
 * Shared collection + compaction for LanguageModelToolResultPart payloads.
 * Used by OpenAI-compat convertMessages and VS Code LM wrapper transport.
 */

import { compactToolResultText, isToolResultCompactionDisabled } from "./toolResultCompaction";

export function collectToolResultPartText(content: readonly unknown[] | undefined): string {
	let text = "";
	for (const part of content ?? []) {
		if (typeof part === "string") {
			text += part;
		} else if (isTextLikePart(part)) {
			text += extractTextValue(part);
		} else if (isImagePart(part)) {
			text += "[Image binary omitted from tool result text channel]";
		} else {
			text += safeStringify(part);
		}
	}
	return text;
}

export function collectAndCompactToolResultPartText(content: readonly unknown[] | undefined): string {
	const raw = collectToolResultPartText(content);
	if (isToolResultCompactionDisabled() || !raw) {
		return raw;
	}
	return compactToolResultText(raw).text;
}

function isTextLikePart(value: unknown): value is { value?: string | readonly string[]; text?: string | readonly string[]; type?: number } {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (typeof record.value === "string" || Array.isArray(record.value))
		|| (typeof record.text === "string" || Array.isArray(record.text))
		|| (typeof record.type === "number" && (typeof record.text === "string"));
}

function isImagePart(value: unknown): value is { mimeType: string; data: unknown } {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.mimeType === "string"
		&& record.mimeType.startsWith("image/")
		&& byteLengthOfData(record.data) > 0;
}

function extractTextValue(part: { value?: string | readonly string[]; text?: string | readonly string[] }): string {
	const value = part.value ?? part.text ?? "";
	return Array.isArray(value) ? value.join("") : String(value);
}

function byteLengthOfData(data: unknown): number {
	if (data instanceof Uint8Array) {
		return data.byteLength;
	}
	if (data instanceof ArrayBuffer) {
		return data.byteLength;
	}
	if (ArrayBuffer.isView(data)) {
		return data.byteLength;
	}
	return 0;
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "{}";
	}
}
