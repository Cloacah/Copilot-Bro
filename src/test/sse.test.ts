import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIStreamParser, parseToolArguments } from "../openaiCompat/sse";
import type { StreamEvent } from "../types";

test("OpenAIStreamParser parses text, thinking, and tool calls", async () => {
	const stream = toStream([
		`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "think" } }] })}\n\n`,
		`data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}\n\n`,
		`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "read_file", arguments: "{\"path\"" } }] } }] })}\n\n`,
		`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":\"a.ts\"}" } }] }, finish_reason: "tool_calls" }] })}\n\n`,
		"data: [DONE]\n\n"
	]);
	const events: StreamEvent[] = [];
	const parser = new OpenAIStreamParser();

	await parser.parse(stream, (event) => {
		events.push(event);
	});

	assert.equal(events[0].type, "thinking");
	assert.equal(events[1].type, "text");
	assert.equal(events[2].type, "finish");
	assert.equal((events[2] as Extract<StreamEvent, { type: "finish" }>).reason, "tool_calls");
	assert.deepEqual(events[3], {
		type: "tool_call",
		id: "call-1",
		name: "read_file",
		input: { path: "a.ts" }
	});
});

test("parseToolArguments rejects non-object JSON", () => {
	assert.equal(parseToolArguments("[]"), undefined);
	assert.deepEqual(parseToolArguments("{\"ok\":true}"), { ok: true });
});

test("OpenAIStreamParser returns after tool_calls finish without waiting for DONE", async () => {
	const stream = toStream([
		`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-early", function: { name: "read_file", arguments: "{\"path\"" } }] } }] })}\n\n`,
		`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":\"a.ts\"}" } }] }, finish_reason: "tool_calls" }] })}\n\n`,
		"data: this-would-fail-if-parser-kept-reading\n\n"
	]);
	const events: StreamEvent[] = [];
	const parser = new OpenAIStreamParser();

	await parser.parse(stream, (event) => {
		events.push(event);
	});

	assert.deepEqual(events, [
		{ type: "finish", reason: "tool_calls" },
		{
			type: "tool_call",
			id: "call-early",
			name: "read_file",
			input: { path: "a.ts" }
		}
	]);
});

test("OpenAIStreamParser reads reasoning from choice.message tool-call chunks", async () => {
	const stream = toStream([
		`data: ${JSON.stringify({
			choices: [
				{
					message: {
						reasoning_content: "message reasoning",
						tool_calls: [
							{
								id: "call-message",
								function: { name: "read_file", arguments: "{\"path\":\"a.ts\"}" }
							}
						]
					},
					finish_reason: "tool_calls"
				}
			]
		})}\n\n`
	]);
	const events: StreamEvent[] = [];
	const parser = new OpenAIStreamParser();

	await parser.parse(stream, (event) => {
		events.push(event);
	});

	const thinkingEvent = events[0] as Extract<StreamEvent, { type: "thinking" }>;
	assert.equal(thinkingEvent.type, "thinking");
	assert.deepEqual(events, [
		{ type: "thinking", text: "message reasoning", id: thinkingEvent.id },
		{ type: "finish", reason: "tool_calls" },
		{
			type: "tool_call",
			id: "call-message",
			name: "read_file",
			input: { path: "a.ts" }
		}
	]);
});

test("OpenAIStreamParser de-duplicates cumulative scalar reasoning_content", async () => {
	const stream = toStream([
		`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "think" } }] })}\n\n`,
		`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking" } }] })}\n\n`,
		`data: ${JSON.stringify({ choices: [{ delta: { content: "answer" }, finish_reason: "stop" }] })}\n\n`,
		"data: [DONE]\n\n"
	]);
	const events: StreamEvent[] = [];
	const parser = new OpenAIStreamParser();

	await parser.parse(stream, (event) => {
		events.push(event);
	});

	assert.deepEqual(events.map((event) => event.type), ["thinking", "thinking", "text", "finish"]);
	assert.equal((events[0] as Extract<StreamEvent, { type: "thinking" }>).text, "think");
	assert.equal((events[1] as Extract<StreamEvent, { type: "thinking" }>).text, "ing");
	assert.equal((events[3] as Extract<StreamEvent, { type: "finish" }>).reason, "stop");
});

test("OpenAIStreamParser emits usage and de-duplicates cumulative reasoning details", async () => {
	const stream = toStream([
		`data: ${JSON.stringify({ choices: [{ delta: { reasoning_details: [{ text: "think" }] } }] })}\n\n`,
		`data: ${JSON.stringify({ choices: [{ delta: { reasoning_details: [{ text: "thinking" }] } }] })}\n\n`,
		`data: ${JSON.stringify({ choices: [{ delta: { content: "done" } }] })}\n\n`,
		`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\n`,
		"data: [DONE]\n\n"
	]);
	const events: StreamEvent[] = [];
	const parser = new OpenAIStreamParser();

	await parser.parse(stream, (event) => {
		events.push(event);
	});

	assert.deepEqual(events.map((event) => event.type), ["thinking", "thinking", "text", "usage"]);
	assert.equal((events[0] as Extract<StreamEvent, { type: "thinking" }>).text, "think");
	assert.equal((events[1] as Extract<StreamEvent, { type: "thinking" }>).text, "ing");
	assert.equal((events[3] as Extract<StreamEvent, { type: "usage" }>).usage.total_tokens, 12);
});

function toStream(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		}
	});
}
