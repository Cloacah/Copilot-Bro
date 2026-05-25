import * as vscode from "vscode";
import { Buffer } from "node:buffer";
import { snapshotHostUiSmokeLogEvidence } from "../../smokeLogBridge/smokeLogEvidence";

/** Matches Logger output channel lines: `[ISO] [LEVEL] event {...}` */
export function hostUiSmokeAutomationLogHasEvent(logText: string, event: string): boolean {
	const needle = `] ${event}`;
	return logText.split(/\r?\n/u).some((line) => line.includes(needle));
}

export async function readHostUiSmokeAutomationLogText(): Promise<string> {
	const configured = vscode.workspace.getConfiguration("extendedModels").get<string>("automationLogFile")?.trim()
		|| process.env.COPILOT_BRO_LOG_FILE?.trim();
	if (!configured) {
		return snapshotHostUiSmokeLogEvidence().join("\n");
	}
	try {
		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(configured));
		return Buffer.from(bytes).toString("utf8");
	} catch {
		return snapshotHostUiSmokeLogEvidence().join("\n");
	}
}
