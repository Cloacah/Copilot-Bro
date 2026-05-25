import * as vscode from "vscode";
import {
	computeProviderRetryDelayMs,
	extractBusinessCodeFromMessage,
	isFatalProviderFailure,
	isTransientProviderFailure,
	shouldAdvanceHostUiModelCandidate
} from "../../../providerTransientErrors";
import { extensionSmokeLogger } from "../extensionSmokeLogger";
import { delay } from "../delay";
import {
	HOST_UI_INTEGRATION_RETRY_DEFAULTS,
	resolveHostUiTestRetryOptions,
	type HostUiIntegrationRetryOptions
} from "./modelCandidates";

export type HostUiIntegrationTurnRunner = (
	match: vscode.LanguageModelChat,
	options: { runtimeModelId: string; attempt: number; candidateIndex: number }
) => Promise<{ ok: true; responseText: string } | { ok: false; message: string }>;

export async function runHostUiIntegrationTurnWithModelFallback(
	resolveMatch: (runtimeModelId: string) => Promise<vscode.LanguageModelChat>,
	candidates: readonly string[],
	runTurn: HostUiIntegrationTurnRunner,
	retry: HostUiIntegrationRetryOptions = resolveHostUiTestRetryOptions()
): Promise<
	| { ok: true; responseText: string; runtimeModelId: string; attempts: number }
	| { ok: false; message: string; runtimeModelId?: string; attempts: number }
> {
	const maxAttemptsPerCandidate = retry.maxAttemptsPerCandidate ?? HOST_UI_INTEGRATION_RETRY_DEFAULTS.maxAttemptsPerCandidate;
	const baseDelayMs = retry.baseDelayMs ?? HOST_UI_INTEGRATION_RETRY_DEFAULTS.baseDelayMs;
	const maxDelayMs = retry.maxDelayMs ?? HOST_UI_INTEGRATION_RETRY_DEFAULTS.maxDelayMs;

	if (candidates.length === 0) {
		return { ok: false, message: "No runtime model candidates configured.", attempts: 0 };
	}

	let totalAttempts = 0;
	let lastMessage = "Host UI integration turn failed.";

	for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
		const runtimeModelId = candidates[candidateIndex];
		let match: vscode.LanguageModelChat;
		try {
			match = await resolveMatch(runtimeModelId);
		} catch (error) {
			lastMessage = error instanceof Error ? error.message : String(error);
			extensionSmokeLogger()?.warn("host-ui-smoke.chat.integration.model.resolve-failed", {
				runtimeModelId,
				candidateIndex,
				message: lastMessage
			});
			if (!shouldAdvanceHostUiModelCandidate(error) || candidateIndex >= candidates.length - 1) {
				return { ok: false, message: lastMessage, runtimeModelId, attempts: totalAttempts };
			}
			continue;
		}

		for (let attempt = 1; attempt <= maxAttemptsPerCandidate; attempt += 1) {
			totalAttempts += 1;
			let outcome: Awaited<ReturnType<HostUiIntegrationTurnRunner>>;
			try {
				outcome = await runTurn(match, { runtimeModelId, attempt, candidateIndex });
			} catch (error) {
				outcome = {
					ok: false,
					message: error instanceof Error ? error.message : String(error)
				};
			}
			if (outcome.ok) {
				extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.turn.success", {
					runtimeModelId,
					attempt,
					candidateIndex,
					totalAttempts
				});
				return { ok: true, responseText: outcome.responseText, runtimeModelId, attempts: totalAttempts };
			}
			lastMessage = outcome.message;
			const errorLike = new Error(outcome.message);
			if (isFatalProviderFailure(errorLike)) {
				extensionSmokeLogger()?.error("host-ui-smoke.chat.integration.turn.fatal", {
					runtimeModelId,
					attempt,
					message: lastMessage
				});
				return { ok: false, message: lastMessage, runtimeModelId, attempts: totalAttempts };
			}
			const canRetrySame = isTransientProviderFailure(errorLike) && attempt < maxAttemptsPerCandidate;
			if (canRetrySame) {
				const businessCode = extractBusinessCodeFromMessage(lastMessage);
				const rateLimited = businessCode === "1302" || businessCode === "1305" || businessCode === "1308" || businessCode === "1312";
				const delayMs = Math.max(
					computeProviderRetryDelayMs(attempt, baseDelayMs, maxDelayMs),
					rateLimited ? 8_000 : 0
				);
				extensionSmokeLogger()?.info("host-ui-smoke.chat.integration.turn.retry", {
					runtimeModelId,
					attempt,
					candidateIndex,
					delayMs,
					message: lastMessage
				});
				await delay(delayMs);
				continue;
			}
			const advance = shouldAdvanceHostUiModelCandidate(errorLike) && candidateIndex < candidates.length - 1;
			extensionSmokeLogger()?.warn("host-ui-smoke.chat.integration.turn.candidate-failed", {
				runtimeModelId,
				attempt,
				candidateIndex,
				advance,
				message: lastMessage
			});
			if (advance) {
				await delay(3_000);
			}
			break;
		}
	}

	extensionSmokeLogger()?.warn("host-ui-smoke.chat.integration.turn.exhausted", {
		message: lastMessage,
		candidates: [...candidates],
		totalAttempts
	});
	return { ok: false, message: lastMessage, attempts: totalAttempts };
}
