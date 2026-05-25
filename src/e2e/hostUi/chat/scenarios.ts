/**
 * Canonical Host UI Chat smoke scenarios (shared by extension + unit tests).
 * Suite runs inside one @bro-smoke participant turn to avoid Chat UI race conditions.
 */
import { HOST_UI_SMOKE_INTEGRATION_SUITE_MARKER } from "./integration";

export const HOST_UI_SMOKE_RUN_SUITE_MARKER = "[host-ui-smoke-run-suite]";

export interface HostUiSmokeChatScenario {
	readonly id: string;
	readonly userPrompt: string;
	readonly expectedTrimmed: string;
}

export const HOST_UI_SMOKE_CHAT_SCENARIO_CANONICAL: readonly HostUiSmokeChatScenario[] = [
	{
		id: "baseline",
		userPrompt: "Reply with exactly BRO_SMOKE_OK_20260506 and nothing else.",
		expectedTrimmed: "BRO_SMOKE_OK_20260506"
	},
	{
		id: "unicode-prompt",
		userPrompt: "请只回复精确字符串：BRO_SMOKE_OK_20260506，不要其它内容。",
		expectedTrimmed: "BRO_SMOKE_OK_20260506"
	},
	{
		id: "markdown-wrap",
		userPrompt: "Return ONLY this token inside a markdown code fence:\n\n```\nBRO_SMOKE_OK_20260506\n```",
		expectedTrimmed: "BRO_SMOKE_OK_20260506"
	},
	{
		id: "whitespace-padding",
		userPrompt: "   \nReply with exactly BRO_SMOKE_OK_20260506 and nothing else.\t  ",
		expectedTrimmed: "BRO_SMOKE_OK_20260506"
	},
	{
		id: "empty-lines",
		userPrompt: "\n\nReply with exactly BRO_SMOKE_OK_20260506 and nothing else.\n\n",
		expectedTrimmed: "BRO_SMOKE_OK_20260506"
	}
] as const;

const DEFAULT_SUITE_IDS = ["baseline", "unicode-prompt", "markdown-wrap"] as const;

export function parseHostUiSmokeChatScenarioIds(env: Pick<NodeJS.ProcessEnv, string>): string[] {
	const raw = env.COPILOT_BRO_UI_SMOKE_CHAT_SCENARIOS?.trim();
	if (raw === "" || raw === "none" || raw === "skip") {
		return [];
	}
	if (!raw) {
		return [...DEFAULT_SUITE_IDS];
	}
	const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
	return parts.length > 0 ? parts : [...DEFAULT_SUITE_IDS];
}

export function resolveHostUiSmokeChatScenarios(env: Pick<NodeJS.ProcessEnv, string>): HostUiSmokeChatScenario[] {
	const ids = parseHostUiSmokeChatScenarioIds(env);
	const byId = new Map(HOST_UI_SMOKE_CHAT_SCENARIO_CANONICAL.map((scenario) => [scenario.id, scenario]));
	const resolved: HostUiSmokeChatScenario[] = [];
	const unknown: string[] = [];
	for (const id of ids) {
		const found = byId.get(id);
		if (found) {
			resolved.push(found);
		} else {
			unknown.push(id);
		}
	}
	if (unknown.length > 0) {
		throw new Error(`Unknown host UI smoke chat scenario id(s): ${unknown.join(", ")}. Known: ${[...byId.keys()].join(", ")}`);
	}
	if (resolved.length === 0 && ids.length > 0) {
		throw new Error("Host UI smoke chat scenario list resolved to empty.");
	}
	return resolved;
}

export function buildHostUiSmokeSuiteChatQuery(env: Pick<NodeJS.ProcessEnv, string> = process.env): string {
	const parts = [`@bro-smoke`, HOST_UI_SMOKE_RUN_SUITE_MARKER];
	if (env.COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION?.trim() !== "0") {
		parts.push(HOST_UI_SMOKE_INTEGRATION_SUITE_MARKER);
	}
	return parts.join(" ");
}

export function shouldRunHostUiSmokeChatSuite(prompt: string): boolean {
	return prompt.includes(HOST_UI_SMOKE_RUN_SUITE_MARKER);
}

/**
 * Normalize LM text before comparing to {@link HostUiSmokeChatScenario.expectedTrimmed}.
 * Real models often return the smoke token inside a markdown fence for the `markdown-wrap` scenario.
 */
export function normalizeHostUiSmokeScenarioResponse(raw: string, scenarioId: string): string {
	const text = raw.trim();
	if (scenarioId !== "markdown-wrap") {
		return text;
	}
	if (!text.startsWith("```")) {
		return text;
	}
	const lines = text.split(/\r?\n/u);
	if (lines.length < 2 || lines.at(-1)?.trim() !== "```") {
		return text;
	}
	if (lines.length === 2) {
		return lines[0].replace(/^```[ \t]*/u, "").trim();
	}
	return lines.slice(1, -1).join("\n").trim();
}
