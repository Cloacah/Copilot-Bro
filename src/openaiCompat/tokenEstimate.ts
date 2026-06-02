/**
 * Prompt token estimation aligned with what we send to OpenAI-compatible APIs.
 * Counts tool calls/results, thinking, images, and tool schema overhead (see DeepSeek billing docs).
 */

import type { LanguageModelChatRequestMessage } from "vscode";
import type { OpenAIMessage } from "../types";
import { collectAndCompactToolResultPartText } from "./toolResultContent";

/** Per-message framing overhead used by OpenAI-style chat templates. */
export const OPENAI_MESSAGE_OVERHEAD_TOKENS = 4;

/** Conservative image placeholder when byte size is unknown (matches prior estimate). */
export const IMAGE_TOKEN_PLACEHOLDER = 1024;

/** Cap for non-image binary data parts (chars ≈ tokens proxy). */
export const DATA_PART_CHAR_CAP = 10_000;

const CJK_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/u;

/**
 * Character-class heuristic (similar to deepseek-v4-for-copilot token UI).
 * Calibrated conservatively: over-estimate slightly vs under-estimate for budget safety.
 */
export function estimateTextTokens(text: string): number {
	if (!text) {
		return 0;
	}
	let tokens = 0;
	let codeRun = 0;
	for (const char of text) {
		if (/\s/u.test(char)) {
			if (codeRun > 0) {
				tokens += Math.ceil(codeRun / 3.5);
				codeRun = 0;
			}
			continue;
		}
		if (CJK_PATTERN.test(char)) {
			if (codeRun > 0) {
				tokens += Math.ceil(codeRun / 3.5);
				codeRun = 0;
			}
			tokens += 1;
			continue;
		}
		if (/[{}[\]();:=<>/`'"#@$%^&*+|\\]/u.test(char)) {
			codeRun++;
			continue;
		}
		if (codeRun > 0) {
			codeRun++;
		} else {
			tokens += 0.28;
		}
	}
	if (codeRun > 0) {
		tokens += Math.ceil(codeRun / 3.5);
	}
	return Math.max(1, Math.ceil(tokens));
}

export function estimateOpenAIMessageTokens(messages: readonly OpenAIMessage[]): number {
	let tokens = 0;
	for (const message of messages) {
		tokens += OPENAI_MESSAGE_OVERHEAD_TOKENS;
		tokens += estimateOpenAIMessageContentTokens(message);
		if (message.reasoning_content) {
			tokens += estimateTextTokens(message.reasoning_content);
		}
		for (const toolCall of message.tool_calls ?? []) {
			tokens += estimateTextTokens(toolCall.id);
			tokens += estimateTextTokens(toolCall.function.name);
			tokens += estimateTextTokens(toolCall.function.arguments);
		}
		if (message.tool_call_id) {
			tokens += estimateTextTokens(message.tool_call_id);
		}
	}
	return Math.max(1, tokens);
}

export function estimateOpenAIMessageContentTokens(message: OpenAIMessage): number {
	if (typeof message.content === "string") {
		return estimateTextTokens(message.content);
	}
	if (Array.isArray(message.content)) {
		let tokens = 0;
		for (const part of message.content) {
			if (part.type === "text") {
				tokens += estimateTextTokens(part.text);
			} else if (part.type === "image_url") {
				tokens += IMAGE_TOKEN_PLACEHOLDER;
			}
		}
		return tokens;
	}
	return 0;
}

export function estimateToolsDefinitionTokens(tools: readonly unknown[]): number {
	let tokens = 0;
	for (const tool of tools) {
		if (!tool || typeof tool !== "object") {
			continue;
		}
		const record = tool as Record<string, unknown>;
		const name = typeof record.name === "string" ? record.name : "";
		const description = typeof record.description === "string" ? record.description : "";
		const schema = record.inputSchema ?? record.parameters;
		tokens += estimateTextTokens(name);
		tokens += estimateTextTokens(description);
		tokens += estimateTextTokens(safeStringify(schema));
		// function wrapper overhead
		tokens += 8;
	}
	return tokens;
}

export function estimateChatCompletionRequestTokens(
	messages: readonly OpenAIMessage[],
	tools: readonly unknown[] = []
): number {
	return estimateOpenAIMessageTokens(messages) + estimateToolsDefinitionTokens(tools);
}

export function estimateTokens(input: string | LanguageModelChatRequestMessage): number {
	if (typeof input === "string") {
		return estimateTextTokens(input);
	}
	let tokens = OPENAI_MESSAGE_OVERHEAD_TOKENS;
	for (const part of input.content ?? []) {
		tokens += estimateLanguageModelPartTokens(part);
	}
	return Math.max(1, tokens);
}

export function estimateLanguageModelPartTokens(part: unknown): number {
	if (typeof part === "string") {
		return estimateTextTokens(part);
	}
	if (!part || typeof part !== "object") {
		return 0;
	}
	const record = part as Record<string, unknown>;
	const ctor = part.constructor?.name?.toLowerCase() ?? "";

	if (isToolCallPart(part)) {
		let tokens = estimateTextTokens(part.name);
		tokens += estimateTextTokens(safeStringify(part.input ?? {}));
		if (typeof part.callId === "string") {
			tokens += estimateTextTokens(part.callId);
		}
		tokens += estimateTextTokens(extractToolCallThinking(part));
		return tokens;
	}
	if (isToolResultPart(part)) {
		return estimateTextTokens(collectToolResultTextForEstimate(part.content));
	}
	if (isImagePart(part)) {
		return IMAGE_TOKEN_PLACEHOLDER;
	}
	if (isThinkingPart(part, ctor)) {
		return estimateTextTokens(extractTextValue(part as { value?: unknown; text?: unknown }));
	}
	if (ctor.includes("prompttsx") || record.value !== undefined && ctor.includes("tsx")) {
		return estimateTextTokens(safeStringify(record.value));
	}
	if (isTextLikePart(part)) {
		const raw = extractTextValue(part as { value?: unknown; text?: unknown });
		const { text, reasoning } = splitReasoningFromVisibleText(raw);
		return estimateTextTokens(text) + estimateTextTokens(reasoning);
	}
	if ("data" in record || "mimeType" in record) {
		const bytes = byteLengthOfData(record.data);
		if (typeof record.mimeType === "string" && record.mimeType.startsWith("image/")) {
			return IMAGE_TOKEN_PLACEHOLDER;
		}
		return estimateTextTokens(String(Math.min(bytes, DATA_PART_CHAR_CAP)));
	}
	return estimateTextTokens(safeStringify(part));
}

/** Footprint for diagnostics: char + token breakdown by OpenAI role. */
export function summarizeOpenAIMessagesFootprint(messages: readonly OpenAIMessage[]): Record<string, unknown> {
	const perRoleChars: Record<string, number> = {};
	const perRoleTokens: Record<string, number> = {};
	const toolResults: Array<{ tool_call_id: string; chars: number; tokens: number; preview: string }> = [];
	let reasoningChars = 0;
	let reasoningTokens = 0;
	let contentChars = 0;
	let contentTokens = 0;

	const add = (role: string, text: string) => {
		const chars = text.length;
		const tokens = estimateTextTokens(text);
		perRoleChars[role] = (perRoleChars[role] ?? 0) + chars;
		perRoleTokens[role] = (perRoleTokens[role] ?? 0) + tokens;
		contentChars += chars;
		contentTokens += tokens;
	};

	for (const message of messages) {
		const role = message.role ?? "unknown";
		if (typeof message.content === "string") {
			add(role, message.content);
		} else if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (part?.type === "text") {
					add(role, (part as { text?: string }).text ?? "");
				}
			}
		}
		if (message.reasoning_content) {
			reasoningChars += message.reasoning_content.length;
			reasoningTokens += estimateTextTokens(message.reasoning_content);
		}
		if (role === "tool" && typeof message.tool_call_id === "string") {
			const toolText = typeof message.content === "string" ? message.content : "";
			toolResults.push({
				tool_call_id: message.tool_call_id,
				chars: toolText.length,
				tokens: estimateTextTokens(toolText),
				preview: toolText.slice(0, 160)
			});
		}
	}

	toolResults.sort((a, b) => b.tokens - a.tokens);
	return {
		totalChars: contentChars + reasoningChars,
		totalTokens: contentTokens + reasoningTokens,
		contentChars,
		contentTokens,
		reasoningChars,
		reasoningTokens,
		perRoleChars,
		perRoleTokens,
		largestToolResults: toolResults.slice(0, 5)
	};
}

function collectToolResultTextForEstimate(content: readonly unknown[] | undefined): string {
	return collectAndCompactToolResultPartText(content);
}

function splitReasoningFromVisibleText(raw: string): { text: string; reasoning: string } {
	// Match messages.ts marker stripping at estimate-time (reasoning billed when replayed on wire).
	const marker = /<!--\s*extended-models-reasoning:([A-Za-z0-9_-]+)\s*-->/g;
	let reasoning = "";
	const text = raw.replace(marker, (_m, encoded: string) => {
		try {
			reasoning += Buffer.from(encoded, "base64url").toString("utf8");
		} catch {
			// ignore
		}
		return "";
	});
	return { text, reasoning };
}

function isTextLikePart(value: unknown): boolean {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (typeof record.value === "string" || Array.isArray(record.value))
		|| (typeof record.text === "string" || Array.isArray(record.text))
		|| (typeof record.type === "number" && (typeof record.text === "string"));
}

function isThinkingPart(value: unknown, ctor: string): boolean {
	return isTextLikePart(value) && ctor.includes("thinking");
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

function isToolCallPart(value: unknown): value is { callId?: string; name: string; input?: unknown } {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.name === "string" && "input" in record;
}

function isToolResultPart(value: unknown): value is { callId: string; content?: readonly unknown[] } {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.callId === "string" && Array.isArray(record.content);
}

function extractTextValue(part: { value?: unknown; text?: unknown }): string {
	const value = part.value ?? part.text ?? "";
	return Array.isArray(value) ? value.join("") : String(value);
}

function extractToolCallThinking(part: unknown): string {
	const record = part && typeof part === "object" ? part as Record<string, unknown> : undefined;
	const thinking = record?.thinking;
	if (typeof thinking === "string") {
		try {
			const parsed = JSON.parse(thinking) as unknown;
			if (parsed && typeof parsed === "object" && typeof (parsed as { text?: string }).text === "string") {
				return (parsed as { text: string }).text;
			}
		} catch {
			return thinking;
		}
	}
	if (thinking && typeof thinking === "object" && typeof (thinking as { text?: string }).text === "string") {
		return (thinking as { text: string }).text;
	}
	return "";
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
	if (typeof data === "string") {
		return Buffer.byteLength(data, "utf8");
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
