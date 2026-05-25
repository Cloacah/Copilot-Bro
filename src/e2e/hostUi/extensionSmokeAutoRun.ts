import * as vscode from "vscode";
import { HostUiSmokeLogEvent } from "../../visionProtocol/hostUiSmokeLogEvents";
import { extensionSmokeLogger } from "./extensionSmokeLogger";
import { hostUiSmokeAutomationLogHasEvent, readHostUiSmokeAutomationLogText } from "./smokeLogIo";
import { delay } from "./delay";

export { delay };

/** After driver GitHub login preflight, open chat + submit without relying on the command palette. */
export async function maybeAutoRunHostUiSmokeChatSuiteAfterGithubPreflight(
	runChatSuite: () => Promise<void>
): Promise<void> {
	if (process.env.COPILOT_BRO_UI_SMOKE_AUTO_RUN_CHAT_SUITE !== "1") {
		return;
	}
	const logger = extensionSmokeLogger();
	const marker = HostUiSmokeLogEvent.githubAuthPreflightEnd;
	logger?.info("host-ui-smoke.chat-suite.auto-run.waiting", { marker });
	const deadline = Date.now() + 180_000;
	while (Date.now() < deadline) {
		const logText = await readHostUiSmokeAutomationLogText();
		if (hostUiSmokeAutomationLogHasEvent(logText, marker)) {
			logger?.info(HostUiSmokeLogEvent.chatSuiteAutoRunStart);
			await delay(1_500);
			await runChatSuite();
			logger?.info(HostUiSmokeLogEvent.chatSuiteAutoRunEnd);
			return;
		}
		await delay(500);
	}
	logger?.warn("host-ui-smoke.chat-suite.auto-run.timeout", { marker });
}
