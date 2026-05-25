import * as vscode from "vscode";
import { assertHostUiSmokeTestButtonExists } from "../fixtures/vision";
import { createImagePathHydrationPolicy } from "../../../toolCooperation/visionPathHydrationPolicy";
import { hydrateImagePartsFromTextPathsForSmoke } from "../../../visionProxy";

export interface HostUiSmokeP6PathHydrationProbeResult {
	ok: boolean;
	hydratedCount: number;
	assetPath: string;
}

export async function runHostUiSmokeP6PathHydrationProbe(
	logger: { info: (message: string, data?: unknown) => void }
): Promise<HostUiSmokeP6PathHydrationProbeResult> {
	const assetPath = await assertHostUiSmokeTestButtonExists();
	const messages: vscode.LanguageModelChatRequestMessage[] = [
		vscode.LanguageModelChatMessage.User([
			new vscode.LanguageModelTextPart(
				`[host-ui-p6-probe] Analyze the UI button image file at: ${assetPath}`
			)
		])
	];
	const policy = createImagePathHydrationPolicy(messages);
	const hydrated = await hydrateImagePartsFromTextPathsForSmoke(messages, logger, policy);
	let hydratedCount = 0;
	for (const message of hydrated) {
		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelDataPart) {
				hydratedCount += 1;
			}
		}
	}
	const ok = hydratedCount >= 1;
	logger.info("host-ui-smoke.p6.path-hydration.probe.end", {
		ok,
		hydratedCount,
		assetPath
	});
	return { ok, hydratedCount, assetPath };
}
