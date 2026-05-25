import * as vscode from "vscode";
import { findModelConfig, getSettings } from "../../config/settings";
import { getRuntimeModelId } from "../../config/modelIdentity";
import type { ModelConfig } from "../../types";

/**
 * Workspace-scoped custom model overlay for Host UI smoke (restored after scenario).
 */
export async function applySmokeCustomModelOverlay(
	runtimeId: string,
	patch: Partial<ModelConfig>
): Promise<() => Promise<void>> {
	const config = vscode.workspace.getConfiguration("extendedModels");
	const previousCustom = config.get<ModelConfig[]>("models") ?? [];
	const snapshot = previousCustom.map((model) => ({ ...model }));
	const settings = getSettings();
	const base = findModelConfig(runtimeId, settings.models);
	if (!base) {
		throw new Error(`Smoke model overlay: runtime id not found: ${runtimeId}`);
	}
	const overlayEntry: ModelConfig = {
		...base,
		...patch,
		id: base.id,
		provider: base.provider
	};
	const without = previousCustom.filter((model) => getRuntimeModelId(model) !== runtimeId);
	await config.update("models", [...without, overlayEntry], vscode.ConfigurationTarget.Workspace);
	return async () => {
		await config.update("models", snapshot, vscode.ConfigurationTarget.Workspace);
	};
}
