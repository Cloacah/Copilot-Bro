import { createHash } from "node:crypto";
import type { LanguageModelChatRequestMessage } from "vscode";
import { normalizeToolCallId } from "../openaiCompat/messages";
import type { ModelCapabilities } from "../toolCooperation/toolSelector";
import type { VisionProcessingConfig } from "../types";

export type VisionSourceKind =
	| "user-attachment"
	| "tool-screenshot"
	| "tool-image"
	| "assistant-inline"
	| "unknown";

export interface VisionImageOccurrence {
	readonly messageIndex: number;
	readonly role: string;
	readonly toolCallId?: string;
	readonly toolName?: string;
	readonly sourceKind: VisionSourceKind;
}

export function resolveVisionSourceKind(role: unknown, toolName?: string): VisionSourceKind {
	const normalizedRole = String(role ?? "").trim().toLowerCase();
	const normalizedTool = toolName?.trim().toLowerCase() ?? "";
	if (normalizedTool === "screenshot_page" || normalizedTool.includes("screenshot")) {
		return "tool-screenshot";
	}
	if (normalizedRole === "tool" || normalizedRole === "tool-result") {
		return normalizedTool ? "tool-image" : "tool-image";
	}
	if (normalizedRole === "user") {
		return "user-attachment";
	}
	if (normalizedRole === "assistant") {
		return "assistant-inline";
	}
	return "unknown";
}

export function buildToolCallNameById(
	messages: readonly LanguageModelChatRequestMessage[]
): ReadonlyMap<string, string> {
	const map = new Map<string, string>();
	for (const message of messages) {
		for (const part of message.content ?? []) {
			if (!isToolCallPart(part)) {
				continue;
			}
			const id = normalizeToolCallId(part.callId);
			if (id && typeof part.name === "string" && part.name.trim()) {
				map.set(id, part.name.trim());
			}
		}
	}
	return map;
}

export function partitionRequestMessageImageParts(message: LanguageModelChatRequestMessage): {
	imageParts: Array<{ mimeType: string; data: unknown }>;
	otherParts: unknown[];
} {
	const imageParts: Array<{ mimeType: string; data: unknown }> = [];
	const otherParts: unknown[] = [];
	for (const part of message.content ?? []) {
		if (isRequestImagePart(part)) {
			imageParts.push(part);
			continue;
		}
		if (isToolResultPart(part)) {
			const nestedKeep: unknown[] = [];
			for (const nested of part.content ?? []) {
				if (isRequestImagePart(nested)) {
					imageParts.push(nested);
				} else {
					nestedKeep.push(nested);
				}
			}
			otherParts.push({
				callId: part.callId,
				content: nestedKeep
			});
			continue;
		}
		otherParts.push(part);
	}
	return { imageParts, otherParts };
}

export function countRequestImageParts(messages: readonly LanguageModelChatRequestMessage[]): number {
	let count = 0;
	for (const message of messages) {
		for (const part of message.content ?? []) {
			if (isRequestImagePart(part)) {
				count += 1;
				continue;
			}
			if (isToolResultPart(part)) {
				for (const nested of part.content ?? []) {
					if (isRequestImagePart(nested)) {
						count += 1;
					}
				}
			}
		}
	}
	return count;
}

export function enumerateVisionImageOccurrences(
	messages: readonly LanguageModelChatRequestMessage[]
): VisionImageOccurrence[] {
	const toolNames = buildToolCallNameById(messages);
	const occurrences: VisionImageOccurrence[] = [];
	for (const [messageIndex, message] of messages.entries()) {
		let toolCallId: string | undefined;
		let toolName: string | undefined;
		for (const part of message.content ?? []) {
			if (isToolResultPart(part)) {
				toolCallId = normalizeToolCallId(part.callId);
				toolName = toolNames.get(toolCallId);
			}
		}
		const role = String(message.role ?? "");
		const bindingToolName = toolName ?? (typeof message.name === "string" ? message.name : undefined);
		const sourceKind = resolveVisionSourceKind(role, bindingToolName);
		const pushIfImage = (part: unknown): void => {
			if (!isRequestImagePart(part)) {
				return;
			}
			occurrences.push({
				messageIndex,
				role,
				toolCallId,
				toolName: bindingToolName,
				sourceKind
			});
		};
		for (const part of message.content ?? []) {
			pushIfImage(part);
			if (isToolResultPart(part)) {
				for (const nested of part.content ?? []) {
					pushIfImage(nested);
				}
			}
		}
	}
	return occurrences;
}

export function collectImageRefsFromRequestMessages(
	messages: readonly LanguageModelChatRequestMessage[]
): string[] {
	const refs: string[] = [];
	const pushBytes = (bytes: Uint8Array, label: string): void => {
		const hash = createHash("sha256").update(bytes).digest("hex");
		refs.push(`${label}|hash:${hash}`);
	};
	for (const message of messages) {
		for (const part of message.content ?? []) {
			if (isRequestImagePart(part)) {
				const bytes = toUint8Array(part.data);
				if (bytes) {
					pushBytes(bytes, part.mimeType);
				}
				continue;
			}
			if (isToolResultPart(part)) {
				for (const nested of part.content ?? []) {
					if (isRequestImagePart(nested)) {
						const bytes = toUint8Array(nested.data);
						if (bytes) {
							pushBytes(bytes, nested.mimeType);
						}
					}
				}
			}
		}
	}
	return refs;
}

export function needsVisionFromRequestMessages(
	messages: readonly LanguageModelChatRequestMessage[],
	modelCaps: ModelCapabilities,
	config: Pick<VisionProcessingConfig, "needVisionGate"> = { needVisionGate: true }
): boolean {
	if (!config.needVisionGate) {
		return false;
	}
	if (countRequestImageParts(messages) === 0) {
		return false;
	}
	return modelCaps.nativeVision || modelCaps.proxyVision || modelCaps.wrapperProxyAvailable;
}

function isToolCallPart(value: unknown): value is { callId: string; name: string } {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.callId === "string" && typeof record.name === "string";
}

function isToolResultPart(value: unknown): value is { callId: string; content?: readonly unknown[] } {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.callId === "string" && Array.isArray(record.content);
}

export function isRequestImagePart(part: unknown): part is { mimeType: string; data: unknown } {
	if (!part || typeof part !== "object") {
		return false;
	}
	const record = part as Record<string, unknown>;
	if (typeof record.mimeType !== "string" || !record.mimeType.startsWith("image/")) {
		return false;
	}
	return toUint8Array(record.data) !== undefined;
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
