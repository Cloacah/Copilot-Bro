import test from "node:test";
import assert from "node:assert/strict";
import { sendChatCompletion } from "../openaiCompat/client";
import { ProviderError } from "../errors";
import type { ModelConfig, StreamEvent } from "../types";

const model: ModelConfig = {
	id: "test-model",
	provider: "test",
	baseUrl: "https://example.com/v1",
	contextLength: 128000,
	maxOutputTokens: 4096,
	vision: false,
	toolCalling: true,
	headers: {},
	extraBody: {},
	includeReasoningInRequest: false,
	editTools: []
};

test("sendChatCompletion treats timeout as stream idle timeout, not total request time", async () => {
	const originalFetch = globalThis.fetch;
	const events: StreamEvent[] = [];
	globalThis.fetch = (async () => new Response(timedStream([
		`data: ${JSON.stringify({ choices: [{ delta: { content: "a" } }] })}\n\n`,
		`data: ${JSON.stringify({ choices: [{ delta: { content: "b" } }] })}\n\n`,
		`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`
	], 30), { status: 200 })) as typeof fetch;

	try {
		await sendChatCompletion({
			apiKey: "secret",
			model,
			body: { model: model.id, messages: [{ role: "user", content: "hello" }], stream: true },
			headers: {},
			retry: { enabled: false, maxAttempts: 1, baseDelayMs: 1, statusCodes: [] },
			timeoutMs: 50,
			onEvent: (event) => {
				events.push(event);
			}
		});
	} finally {
		globalThis.fetch = originalFetch;
	}

	assert.deepEqual(events, [
		{ type: "text", text: "a" },
		{ type: "text", text: "b" },
		{ type: "finish", reason: "stop" }
	]);
});

test("sendChatCompletion times out when provider stream is idle", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => new Response(timedStream([
		`data: ${JSON.stringify({ choices: [{ delta: { content: "late" } }] })}\n\n`
	], 80), { status: 200 })) as typeof fetch;

	try {
		await assert.rejects(
			sendChatCompletion({
				apiKey: "secret",
				model,
				body: { model: model.id, messages: [{ role: "user", content: "hello" }], stream: true },
				headers: {},
				retry: { enabled: false, maxAttempts: 1, baseDelayMs: 1, statusCodes: [] },
				timeoutMs: 30,
				onEvent: () => {}
			}),
			(error: unknown) => error instanceof ProviderError
				&& error.code === "TIMEOUT"
				&& error.message.includes("without provider stream activity")
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

function timedStream(chunks: string[], delayMs: number): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			for (const chunk of chunks) {
				await sleep(delayMs);
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		}
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
