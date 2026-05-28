export type VisionHandoffIntent = "describe-only" | "restore-artifact";

const DESCRIBE_ONLY_PATTERN =
	/describe-only|path-only hydration|\[host-ui-p6\]|仅描述|不还原|without restoration|no svg restoration|describe only/iu;

const RESTORE_ARTIFACT_PATTERN =
	/restore|还原|矢量化|vector restoration|抠图|perfect vector|restore-artifact|\[host-ui-p7-restore|svg.?mode|高保真还原|extract.+element/iu;

/** User turn asks for description/summary without explicit restore markers. */
const USER_DESCRIBE_VERB_PATTERN = /\bdescribe\b|描述|summariz|总结/iu;

export function resolveVisionHandoffIntent(prompt: string): VisionHandoffIntent {
	const normalized = prompt.trim();
	if (!normalized) {
		return "describe-only";
	}
	if (DESCRIBE_ONLY_PATTERN.test(normalized)) {
		return "describe-only";
	}
	if (RESTORE_ARTIFACT_PATTERN.test(normalized)) {
		return "restore-artifact";
	}
	return "describe-only";
}

/**
 * User turn text wins over global vision prompts (highFidelityPrompt often mentions restoration).
 */
export function resolveVisionHandoffIntentForTurn(
	userTurnPrompt: string,
	proxyConfigPrompt: string
): VisionHandoffIntent {
	const user = userTurnPrompt.trim();
	if (user) {
		if (DESCRIBE_ONLY_PATTERN.test(user)) {
			return "describe-only";
		}
		if (RESTORE_ARTIFACT_PATTERN.test(user)) {
			return "restore-artifact";
		}
		if (USER_DESCRIBE_VERB_PATTERN.test(user)) {
			return "describe-only";
		}
	}
	return resolveVisionHandoffIntent(proxyConfigPrompt);
}

/**
 * Effective handoff intent for the current runtime.
 *
 * When the high-fidelity restore pipeline is suspended, restoration tasks cannot be executed and
 * should not be requested from vision proxy models. Force describe-only to keep outputs aligned.
 */
export function resolveEffectiveVisionHandoffIntentForTurn(
	userTurnPrompt: string,
	proxyConfigPrompt: string,
	opts: { isRestorePipelineSuspended: boolean }
): VisionHandoffIntent {
	if (opts.isRestorePipelineSuspended) {
		return "describe-only";
	}
	return resolveVisionHandoffIntentForTurn(userTurnPrompt, proxyConfigPrompt);
}
