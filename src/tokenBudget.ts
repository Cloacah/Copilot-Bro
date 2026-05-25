import type { Logger } from "./logger";
import type { ModelConfig } from "./types";

/** Warn when estimated prompt tokens exceed this fraction of the effective input budget. */
const WARN_PRESSURE_RATIO = 0.88;

function effectiveMaxOutputTokens(model: ModelConfig): number {
	const configured = model.maxCompletionTokens ?? model.maxOutputTokens ?? 4096;
	return Math.max(1, Math.min(configured, Math.max(1, model.contextLength - 1)));
}

export function computeEffectiveInputTokenBudget(model: ModelConfig): number {
	return Math.max(1, model.contextLength - effectiveMaxOutputTokens(model));
}

export function promptToContextPressure(estimatedPromptTokens: number, model: ModelConfig): number {
	const budget = computeEffectiveInputTokenBudget(model);
	return estimatedPromptTokens / budget;
}

export function logPromptBudgetPressure(logger: Logger, model: ModelConfig, estimatedPromptTokens: number): void {
	const ratio = promptToContextPressure(estimatedPromptTokens, model);
	if (ratio < WARN_PRESSURE_RATIO) {
		return;
	}
	logger.warn("request.prompt.tokenPressure", {
		model: model.id,
		estimatedPromptTokens,
		inputBudgetTokens: computeEffectiveInputTokenBudget(model),
		ratio: Number(ratio.toFixed(3))
	});
}

/** Ordered slice for greedy token budgeting (e.g. memory snippets, tool summaries). */
export interface TokenBudgetSlice {
	readonly id: string;
	readonly estimatedTokens: number;
}

/**
 * Retain a prefix of ordered slices whose cumulative `estimatedTokens` stays within `maxTokens`.
 * Later slices are dropped once the budget would be exceeded (greedy from list start).
 */
export function selectGreedyPrefixWithinTokenBudget(
	slices: readonly TokenBudgetSlice[],
	maxTokens: number
): { retained: TokenBudgetSlice[]; dropped: TokenBudgetSlice[]; totalRetainedTokens: number } {
	if (!Number.isFinite(maxTokens) || maxTokens < 0) {
		throw new RangeError("maxTokens must be a finite non-negative number");
	}
	const retained: TokenBudgetSlice[] = [];
	const dropped: TokenBudgetSlice[] = [];
	let sum = 0;
	for (const s of slices) {
		if (!Number.isFinite(s.estimatedTokens) || s.estimatedTokens < 0) {
			throw new RangeError(`slice "${s.id}": estimatedTokens must be a finite non-negative number`);
		}
		if (sum + s.estimatedTokens <= maxTokens) {
			retained.push(s);
			sum += s.estimatedTokens;
		} else {
			dropped.push(s);
		}
	}
	return { retained, dropped, totalRetainedTokens: sum };
}
