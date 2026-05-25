import type { StreamEvent } from "../types";
import { ProviderError } from "../errors";

interface ToolBuffer {
	id?: string;
	name?: string;
	args: string;
}

export class OpenAIStreamParser {
	private readonly toolBuffers = new Map<number, ToolBuffer>();
	private readonly completedToolIndices = new Set<number>();
	private readonly reasoningDetailBuffers = new Map<number, string>();
	private readonly scalarReasoningBuffers = new Map<number, string>();
	private xmlThinkingActive = false;
	private xmlThinkingDetectionDone = false;
	private thinkingId: string | undefined;

	async parse(
		body: ReadableStream<Uint8Array>,
		onEvent: (event: StreamEvent) => void | Promise<void>,
		token?: { readonly isCancellationRequested?: boolean },
		onActivity?: () => void
	): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			for (;;) {
				if (token?.isCancellationRequested) {
					throw new ProviderError("The model request was cancelled.", { code: "CANCELLED", retryable: false });
				}

				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				onActivity?.();
				const lines = buffer.split(/\r?\n/);
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (await this.processLine(line, onEvent)) {
						return;
					}
				}
			}

			if (buffer.trim()) {
				if (await this.processLine(buffer, onEvent)) {
					return;
				}
			}
			this.flushToolCalls(onEvent, false);
		} finally {
			reader.releaseLock();
		}
	}

	private async processLine(line: string, onEvent: (event: StreamEvent) => void | Promise<void>): Promise<boolean> {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith(":")) {
			return false;
		}
		if (!trimmed.startsWith("data:")) {
			return false;
		}

		const data = trimmed.slice(5).trim();
		if (!data || data === "[DONE]") {
			this.flushToolCalls(onEvent, false);
			return true;
		}

		let chunk: Record<string, unknown>;
		try {
			chunk = JSON.parse(data) as Record<string, unknown>;
		} catch {
			throw new ProviderError("Failed to parse provider SSE chunk.", {
				code: "SSE_PARSE",
				body: data,
				retryable: false
			});
		}

		return await this.processChunk(chunk, onEvent);
	}

	private async processChunk(
		chunk: Record<string, unknown>,
		onEvent: (event: StreamEvent) => void | Promise<void>
	): Promise<boolean> {
		const usage = asRecord(chunk.usage);
		if (usage) {
			await onEvent({ type: "usage", usage });
		}

		const choice = getFirstChoice(chunk);
		if (!choice) {
			return false;
		}
		const delta = asRecord(choice.delta) ?? {};

		const thinkingText = this.extractThinkingText(choice, delta);
		if (thinkingText) {
			this.thinkingId ??= `thinking_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			await onEvent({ type: "thinking", text: thinkingText, id: this.thinkingId });
		}

		const content = typeof delta.content === "string" ? delta.content : "";
		if (content) {
			const consumed = await this.processXmlThinking(content, onEvent);
			if (!consumed) {
				await onEvent({ type: "text", text: content });
			}
		}

		const message = asRecord(choice.message);
		const rawToolCalls = Array.isArray(delta.tool_calls)
			? delta.tool_calls
			: Array.isArray(message?.tool_calls)
				? message.tool_calls
				: [];
		const toolCalls = rawToolCalls;
		for (const rawToolCall of toolCalls) {
			const toolCall = asRecord(rawToolCall);
			if (!toolCall) {
				continue;
			}
			const index = typeof toolCall.index === "number" ? toolCall.index : 0;
			if (this.completedToolIndices.has(index)) {
				continue;
			}
			const buffer = this.toolBuffers.get(index) ?? { args: "" };
			if (typeof toolCall.id === "string") {
				buffer.id = toolCall.id;
			}
			const fn = asRecord(toolCall.function);
			if (typeof fn?.name === "string") {
				buffer.name = fn.name;
			}
			if (typeof fn?.arguments === "string") {
				buffer.args += fn.arguments;
			}
			this.toolBuffers.set(index, buffer);
		}

		const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
		if (finishReason) {
			await onEvent({ type: "finish", reason: finishReason });
			this.flushToolCalls(onEvent, finishReason === "tool_calls");
			return true;
		}
		return false;
	}

	private async processXmlThinking(
		content: string,
		onEvent: (event: StreamEvent) => void | Promise<void>
	): Promise<boolean> {
		if (this.xmlThinkingDetectionDone && !this.xmlThinkingActive) {
			return false;
		}

		let rest = content;
		let consumed = false;

		while (rest.length > 0) {
			if (!this.xmlThinkingActive) {
				const start = rest.indexOf("<think>");
				if (start === -1) {
					if (consumed && rest) {
						await onEvent({ type: "text", text: rest });
					}
					return consumed;
				}
				if (start > 0) {
					await onEvent({ type: "text", text: rest.slice(0, start) });
				}
				consumed = true;
				this.xmlThinkingActive = true;
				rest = rest.slice(start + "<think>".length);
				continue;
			}

			const end = rest.indexOf("</think>");
			const text = end === -1 ? rest : rest.slice(0, end);
			if (text) {
				this.thinkingId ??= `thinking_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
				await onEvent({ type: "thinking", text, id: this.thinkingId });
			}
			consumed = true;
			if (end === -1) {
				return true;
			}
			this.xmlThinkingActive = false;
			rest = rest.slice(end + "</think>".length);
		}

		return consumed;
	}

	private extractThinkingText(choice: Record<string, unknown>, delta: Record<string, unknown>): string {
		const details = delta.reasoning_details ?? choice.reasoning_details;
		if (Array.isArray(details)) {
			return details.map((item, index) => {
				const text = extractReasoningDetail(asRecord(item));
				const previous = this.reasoningDetailBuffers.get(index) ?? "";
				this.reasoningDetailBuffers.set(index, text || previous);
				return text.startsWith(previous) ? text.slice(previous.length) : text;
			}).filter(Boolean).join("");
		}
		const index = typeof choice.index === "number" ? choice.index : 0;
		const raw = extractScalarThinkingText(choice, delta);
		if (!raw) {
			return "";
		}
		const previous = this.scalarReasoningBuffers.get(index) ?? "";
		let incremental = raw;
		if (previous && raw.startsWith(previous)) {
			incremental = raw.slice(previous.length);
		} else if (previous && previous.startsWith(raw)) {
			incremental = "";
		}
		if (incremental) {
			this.scalarReasoningBuffers.set(index, previous + incremental);
		}
		return incremental;
	}

	private flushToolCalls(onEvent: (event: StreamEvent) => void | Promise<void>, throwOnInvalid: boolean): void {
		for (const [index, buffer] of Array.from(this.toolBuffers.entries())) {
			if (!buffer.name) {
				continue;
			}
			const parsed = parseToolArguments(buffer.args.trim() || "{}");
			if (!parsed) {
				if (throwOnInvalid) {
					throw new ProviderError(`Tool call ${buffer.name} returned invalid JSON arguments.`, {
						code: "TOOL_ARGUMENTS",
						body: buffer.args,
						retryable: false
					});
				}
				continue;
			}
			onEvent({
				type: "tool_call",
				id: buffer.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
				name: buffer.name,
				input: parsed
			});
			this.toolBuffers.delete(index);
			this.completedToolIndices.add(index);
		}
	}
}

export function parseToolArguments(text: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(text || "{}") as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function getFirstChoice(chunk: Record<string, unknown>): Record<string, unknown> | undefined {
	const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
	return asRecord(choices[0]);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function extractScalarThinkingText(choice: Record<string, unknown>, delta: Record<string, unknown>): string {
	const message = asRecord(choice.message);
	for (const key of ["reasoning_content", "reasoning", "thinking"]) {
		const value = delta[key] ?? choice[key] ?? message?.[key];
		if (typeof value === "string") {
			return value;
		}
		const record = asRecord(value);
		if (typeof record?.text === "string") {
			return record.text;
		}
	}
	return "";
}

function extractReasoningDetail(detail: Record<string, unknown> | undefined): string {
	if (!detail) {
		return "";
	}
	for (const key of ["text", "summary"]) {
		if (typeof detail[key] === "string") {
			return detail[key] as string;
		}
	}
	if (detail.type === "reasoning.encrypted") {
		return "[REDACTED]";
	}
	return "";
}
