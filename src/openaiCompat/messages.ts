import type { LanguageModelChatRequestMessage } from "vscode";
import type { ModelConfig, OpenAIContentPart, OpenAIMessage, OpenAIToolCall } from "../types";

const REASONING_MARKER_PATTERN = /<!--\s*extended-models-reasoning:([A-Za-z0-9_-]+)\s*-->/g;
const REASONING_DETAILS_PATTERN = /<details data-extended-models-reasoning="true">[\s\S]*?<\/details>\s*/g;
const VSCODE_TOOL_CALL_SUFFIX_PATTERN = /__vscode-\d+$/;
const TAG_BASE = 0xE0000;
const TAG_START = String.fromCodePoint(0xE0001);
const TAG_END = String.fromCodePoint(0xE0002);

export interface RoleIds {
	user: unknown;
	assistant: unknown;
}

export function convertMessages(
	messages: readonly LanguageModelChatRequestMessage[],
	model: ModelConfig,
	roleIds: RoleIds
): OpenAIMessage[] {
	const out: OpenAIMessage[] = [];

	for (const message of messages) {
		const role = mapRole(message.role, roleIds);
		const textParts: string[] = [];
		const imageParts: OpenAIContentPart[] = [];
		const toolCalls: OpenAIToolCall[] = [];
		const toolResults: OpenAIMessage[] = [];
		const reasoningParts: string[] = [];

		for (const part of message.content ?? []) {
			if (isToolCallPart(part)) {
				toolCalls.push({
					id: normalizeToolCallId(part.callId) || `call_${Math.random().toString(36).slice(2, 10)}`,
					type: "function",
					function: {
						name: part.name,
						arguments: safeStringify(part.input ?? {})
					}
				});
				const toolThinking = extractToolCallThinking(part);
				if (toolThinking) {
					reasoningParts.push(toolThinking);
				}
			} else if (isToolResultPart(part)) {
				toolResults.push({
					role: "tool",
					tool_call_id: normalizeToolCallId(part.callId),
					content: collectText(part.content)
				});
			} else if (isImagePart(part)) {
				if (model.vision) {
					imageParts.push({
						type: "image_url",
						image_url: {
							url: createDataUrl(part)
						}
					});
				}
			} else if (isThinkingPart(part)) {
				reasoningParts.push(extractTextValue(part));
			} else if (isTextLikePart(part)) {
				const extracted = extractReasoningMarkers(extractTextValue(part));
				if (extracted.reasoning) {
					reasoningParts.push(extracted.reasoning);
				}
				if (extracted.text) {
					textParts.push(extracted.text);
				}
			}
		}

		const text = textParts.join("");
		const reasoning = reasoningParts.join("").trim();

		if (role === "assistant") {
			const assistant: OpenAIMessage = {
				role: "assistant"
			};
			if (text.trim()) {
				assistant.content = text;
			}
			if (shouldIncludeReasoning(model, toolCalls.length > 0) && reasoning) {
				assistant.reasoning_content = reasoning;
			}
			if (toolCalls.length > 0) {
				assistant.tool_calls = toolCalls;
			}
			if (assistant.content || assistant.reasoning_content || assistant.tool_calls) {
				out.push(assistant);
			}
			out.push(...toolResults);
			continue;
		}

		out.push(...toolResults);

		if (!text.trim() && imageParts.length === 0) {
			continue;
		}

		if (role === "user" && imageParts.length > 0) {
			const content: OpenAIContentPart[] = [];
			if (text.trim()) {
				content.push({ type: "text", text });
			}
			content.push(...imageParts);
			out.push({ role, content });
		} else {
			out.push({ role, content: text });
		}
	}

	return out;
}

export function estimateTokens(input: string | LanguageModelChatRequestMessage): number {
	if (typeof input === "string") {
		return estimateTextTokens(input);
	}

	let tokens = 4;
	for (const part of input.content ?? []) {
		if (isImagePart(part)) {
			tokens += 1024;
		} else if (isToolCallPart(part)) {
			tokens += estimateTextTokens(part.name) + estimateTextTokens(safeStringify(part.input ?? {}));
		} else if (isToolResultPart(part)) {
			tokens += estimateTextTokens(collectText(part.content));
		} else if (isTextLikePart(part) || isThinkingPart(part)) {
			tokens += estimateTextTokens(extractReasoningMarkers(extractTextValue(part)).text);
		}
	}
	return tokens;
}

export function estimateOpenAIMessageTokens(messages: readonly OpenAIMessage[]): number {
	let tokens = 0;
	for (const message of messages) {
		tokens += 4;
		if (typeof message.content === "string") {
			tokens += estimateTextTokens(message.content);
		} else if (Array.isArray(message.content)) {
			for (const part of message.content) {
				tokens += part.type === "text" ? estimateTextTokens(part.text) : 1024;
			}
		}
		if (message.reasoning_content) {
			tokens += estimateTextTokens(message.reasoning_content);
		}
		for (const toolCall of message.tool_calls ?? []) {
			tokens += estimateTextTokens(toolCall.function.name) + estimateTextTokens(toolCall.function.arguments);
		}
		if (message.tool_call_id) {
			tokens += estimateTextTokens(message.tool_call_id);
		}
	}
	return Math.max(1, tokens);
}

export interface ReasoningReplayLookup {
	getReasoning(callId: string): string | undefined;
	getAssistantMessage(callId: string): OpenAIMessage | undefined;
	getReasoningForAssistant?(message: OpenAIMessage): string | undefined;
}

export function repairReasoningToolHistory(
	messages: OpenAIMessage[],
	model: ModelConfig,
	lookup: ReasoningReplayLookup
): OpenAIMessage[] {
	if (!requiresReasoningReplay(model)) {
		return messages;
	}

	const out: OpenAIMessage[] = [];
	const seenToolCalls = new Set<string>();
	const droppedToolCalls = new Set<string>();
	const hasToolContext = messages.some((message) =>
		(message.role === "assistant" && Boolean(message.tool_calls?.length))
		|| message.role === "tool"
	);
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (message.role === "assistant" && message.tool_calls?.length) {
			const repaired = cloneMessage(message);
			const toolCalls = repaired.tool_calls ?? [];
			for (const toolCall of toolCalls) {
				toolCall.id = normalizeToolCallId(toolCall.id);
			}
			const availableToolResultIds = collectContiguousToolResultIds(messages, index + 1);
			const retainedToolCalls = toolCalls.filter((toolCall) => availableToolResultIds.has(toolCall.id));
			if (retainedToolCalls.length === 0) {
				continue;
			}
			const reasoning = repaired.reasoning_content ?? findReasoningForToolCalls(toolCalls, lookup);
			if (!reasoning?.trim()) {
				for (const toolCall of toolCalls) {
					droppedToolCalls.add(toolCall.id);
				}
				continue;
			}
			repaired.tool_calls = retainedToolCalls;
			repaired.reasoning_content = reasoning;
			out.push(repaired);
			for (const toolCall of retainedToolCalls) {
				seenToolCalls.add(toolCall.id);
			}
			continue;
		}

		if (message.role === "assistant" && hasToolContext) {
			const repaired = cloneMessage(message);
			const reasoning = repaired.reasoning_content ?? lookup.getReasoningForAssistant?.(repaired);
			if (reasoning?.trim()) {
				repaired.reasoning_content = reasoning;
			}
			out.push(repaired);
			continue;
		}

		if (message.role === "tool" && message.tool_call_id) {
			const normalizedToolCallId = normalizeToolCallId(message.tool_call_id);
			if (droppedToolCalls.has(normalizedToolCallId)) {
				continue;
			}
			const repairedToolMessage = normalizedToolCallId === message.tool_call_id
				? message
				: { ...message, tool_call_id: normalizedToolCallId };
			if (!seenToolCalls.has(normalizedToolCallId)) {
				const cachedAssistant = lookup.getAssistantMessage(normalizedToolCallId);
				if (!cachedAssistant) {
					// DeepSeek rejects orphan tool results in thinking mode because the required
					// assistant reasoning/tool_call message cannot be reconstructed safely.
					continue;
				}
				const repaired = cloneMessage(cachedAssistant);
				const toolCalls = repaired.tool_calls ?? [];
				for (const toolCall of toolCalls) {
					toolCall.id = normalizeToolCallId(toolCall.id);
				}
				const availableToolResultIds = collectContiguousToolResultIds(messages, index);
				const retainedToolCalls = toolCalls.filter((toolCall) => availableToolResultIds.has(toolCall.id));
				if (retainedToolCalls.length === 0) {
					continue;
				}
				const reasoning = repaired.reasoning_content ?? findReasoningForToolCalls(toolCalls, lookup);
				if (!reasoning?.trim()) {
					for (const toolCall of toolCalls) {
						droppedToolCalls.add(toolCall.id);
					}
					continue;
				}
				repaired.tool_calls = retainedToolCalls;
				repaired.reasoning_content = reasoning;
				out.push(repaired);
				for (const toolCall of retainedToolCalls) {
					seenToolCalls.add(toolCall.id);
				}
			}
			out.push(repairedToolMessage);
			continue;
		}

		out.push(message);
	}

	return out;
}

function collectContiguousToolResultIds(messages: readonly OpenAIMessage[], startIndex: number): Set<string> {
	const ids = new Set<string>();
	for (let index = startIndex; index < messages.length; index += 1) {
		const message = messages[index];
		if (message.role !== "tool" || !message.tool_call_id) {
			break;
		}
		ids.add(normalizeToolCallId(message.tool_call_id));
	}
	return ids;
}

export function stripReasoningContent(messages: OpenAIMessage[]): OpenAIMessage[] {
	return messages.map((message) => {
		if (!message.reasoning_content) {
			return message;
		}
		const { reasoning_content: _reasoningContent, ...rest } = message;
		return rest;
	});
}

export function normalizeToolCallId(callId: string | undefined): string {
	return callId?.replace(VSCODE_TOOL_CALL_SUFFIX_PATTERN, "") ?? "";
}

export function encodeReasoningMarker(text: string): string {
	if (!text) {
		return "";
	}
	const encoded = Buffer.from(text, "utf8").toString("base64url");
	return `${TAG_START}${Array.from(encoded, (char) => String.fromCodePoint(TAG_BASE + char.charCodeAt(0))).join("")}${TAG_END}`;
}

function extractReasoningMarkers(text: string): { text: string; reasoning: string } {
	let reasoning = "";
	const legacyStripped = text.replace(REASONING_MARKER_PATTERN, (_match, encoded: string) => {
		try {
			reasoning += Buffer.from(encoded, "base64url").toString("utf8");
		} catch {
			// Keep malformed markers visible rather than silently dropping user-visible text.
			return _match;
		}
		return "";
	});
	const stripped = stripInvisibleReasoningMarkers(legacyStripped, (encoded) => {
		reasoning += Buffer.from(encoded, "base64url").toString("utf8");
	});
	const visibleText = stripped
		.replace(REASONING_DETAILS_PATTERN, "")
		.replace(/^\s+(?=\S)/, "");
	return {
		text: visibleText,
		reasoning
	};
}

function stripInvisibleReasoningMarkers(text: string, onEncoded: (encoded: string) => void): string {
	const chars = Array.from(text);
	let out = "";
	for (let i = 0; i < chars.length; i++) {
		if (chars[i] !== TAG_START) {
			out += chars[i];
			continue;
		}

		let encoded = "";
		let closed = false;
		for (let j = i + 1; j < chars.length; j++) {
			if (chars[j] === TAG_END) {
				i = j;
				closed = true;
				break;
			}
			const codePoint = chars[j].codePointAt(0);
			if (codePoint === undefined || codePoint < TAG_BASE || codePoint > TAG_BASE + 127) {
				closed = false;
				break;
			}
			encoded += String.fromCharCode(codePoint - TAG_BASE);
		}

		if (!closed) {
			out += chars[i];
			continue;
		}

		try {
			onEncoded(encoded);
		} catch {
			out += `${TAG_START}${encoded}${TAG_END}`;
		}
	}
	return out;
}

function shouldIncludeReasoning(model: ModelConfig, hasToolCalls: boolean): boolean {
	if (model.includeReasoningInRequest) {
		return true;
	}
	if (!hasToolCalls) {
		return false;
	}
	if (model.thinking?.type !== "enabled") {
		return false;
	}
	return hasReasoningReplayProtocol(model);
}

function requiresReasoningReplay(model: ModelConfig): boolean {
	if (model.includeReasoningInRequest) {
		return true;
	}
	if (model.thinking?.type !== "enabled") {
		return false;
	}
	return hasReasoningReplayProtocol(model);
}

function hasReasoningReplayProtocol(model: ModelConfig): boolean {
	const provider = model.provider.trim().toLowerCase();
	const baseUrl = model.baseUrl?.toLowerCase() ?? "";
	return provider.includes("deepseek")
		|| provider.includes("kimi")
		|| provider.includes("moonshot")
		|| baseUrl.includes("deepseek")
		|| baseUrl.includes("moonshot");
}

function findReasoningForToolCalls(toolCalls: readonly OpenAIToolCall[], lookup: ReasoningReplayLookup): string | undefined {
	const byToolCall = toolCalls
		.map((toolCall) => lookup.getReasoning(toolCall.id))
		.find((reasoning): reasoning is string => Boolean(reasoning?.trim()));
	if (byToolCall) {
		return byToolCall;
	}
	return lookup.getReasoningForAssistant?.({
		role: "assistant",
		tool_calls: toolCalls.map((toolCall) => ({
			id: normalizeToolCallId(toolCall.id),
			type: "function",
			function: {
				name: toolCall.function.name,
				arguments: toolCall.function.arguments
			}
		}))
	});
}

function cloneMessage(message: OpenAIMessage): OpenAIMessage {
	return {
		...message,
		tool_calls: message.tool_calls?.map((toolCall) => ({
			id: toolCall.id,
			type: "function",
			function: {
				name: toolCall.function.name,
				arguments: toolCall.function.arguments
			}
		}))
	};
}

function mapRole(role: unknown, roleIds: RoleIds): "system" | "user" | "assistant" {
	if (role === roleIds.user) {
		return "user";
	}
	if (role === roleIds.assistant) {
		return "assistant";
	}
	return "system";
}

function estimateTextTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

function isTextLikePart(value: unknown): value is { value: string | readonly string[] } {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (typeof record.value === "string" || Array.isArray(record.value))
		|| (typeof record.text === "string" || Array.isArray(record.text));
}

function isThinkingPart(value: unknown): value is { value: string | readonly string[] } {
	if (!isTextLikePart(value)) {
		return false;
	}
	const name = value.constructor?.name?.toLowerCase() ?? "";
	return name.includes("thinking");
}

function isImagePart(value: unknown): value is { mimeType: string; data: unknown } {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.mimeType === "string"
		&& record.mimeType.startsWith("image/")
		&& toUint8Array(record.data) !== undefined;
}

function isToolCallPart(value: unknown): value is { callId?: string; name: string; input?: unknown } {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.name === "string" && "input" in record;
}

function extractToolCallThinking(part: unknown): string {
	const record = asRecord(part);
	const thinking = record?.thinking;
	if (typeof thinking === "string") {
		try {
			const parsed = JSON.parse(thinking) as unknown;
			const parsedRecord = asRecord(parsed);
			if (typeof parsedRecord?.text === "string") {
				return parsedRecord.text;
			}
		} catch {
			return thinking;
		}
	}
	const thinkingRecord = asRecord(thinking);
	if (typeof thinkingRecord?.text === "string") {
		return thinkingRecord.text;
	}
	return "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function isToolResultPart(value: unknown): value is { callId: string; content?: readonly unknown[] } {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.callId === "string" && Array.isArray(record.content);
}

function extractTextValue(part: { value?: string | readonly string[]; text?: string | readonly string[] }): string {
	const value = part.value ?? part.text ?? "";
	return Array.isArray(value) ? value.join("") : String(value);
}

function collectText(content: readonly unknown[] | undefined): string {
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

function createDataUrl(part: { mimeType: string; data: unknown }): string {
	const bytes = toUint8Array(part.data);
	if (!bytes) {
		return "";
	}
	return `data:${part.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function toUint8Array(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) {
		return value;
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView;
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}
	if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
		return new Uint8Array(value);
	}
	return undefined;
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "{}";
	}
}
