import * as vscode from "vscode";
import { getRuntimeModelId } from "../../config/settings";
import {
	HOST_UI_DEFAULT_TEXT_PROFILE,
	HOST_UI_SMOKE_PROVIDER_TEXT_PROFILE,
	resolveHostUiModelProfilePrimary
} from "./chat/hostUiModelProfiles";
import { getCachedWrappedLanguageModelConfigs, refreshWrappedLanguageModelConfigs } from "../../vscodeLmWrapper";
import { extensionSmokeLogger } from "./extensionSmokeLogger";
import { delay } from "./extensionSmokeAutoRun";
import { HOST_UI_SMOKE_PROMPT } from "./smokePrompt";

export { HOST_UI_SMOKE_PROMPT } from "./smokePrompt";

let refreshHostUiSmokeWrappedModels: (() => Promise<void>) | undefined;
let lastHostUiSmokeWrappedSnapshot = "";
let hostUiSmokeExtensionContext: vscode.ExtensionContext | undefined;

export const DEFAULT_HOST_UI_SMOKE_MODEL_PROVIDER = "deepseek";
export const DEFAULT_HOST_UI_SMOKE_MODEL_ID = "deepseek-v4-flash";
export const DEFAULT_HOST_UI_SMOKE_TEXT_PROFILE = HOST_UI_DEFAULT_TEXT_PROFILE;
export function bindExtensionSmokeWrappedRefresh(refresh: (() => Promise<void>) | undefined): void {
	refreshHostUiSmokeWrappedModels = refresh;
}

export function bindExtensionSmokeContext(context: vscode.ExtensionContext | undefined): void {
	hostUiSmokeExtensionContext = context;
}

export function getExtensionSmokeContext(): vscode.ExtensionContext | undefined {
	return hostUiSmokeExtensionContext;
}

export function getHostUiSmokeRuntimeModelId(): string | undefined {
	const explicitRuntimeId = process.env.COPILOT_BRO_UI_SMOKE_RUNTIME_MODEL_ID?.trim();
	if (explicitRuntimeId) {
		return explicitRuntimeId;
	}
	if (getHostUiSmokeModelKind() === "wrapped") {
		return getHostUiSmokeWrappedRuntimeModelId();
	}
	const provider = process.env.COPILOT_BRO_UI_SMOKE_MODEL_PROVIDER?.trim().toLowerCase() || DEFAULT_HOST_UI_SMOKE_MODEL_PROVIDER;
	if (process.env.COPILOT_BRO_UI_SMOKE_MODEL_ID?.trim()) {
		return `${process.env.COPILOT_BRO_UI_SMOKE_MODEL_ID.trim()}::${provider}`;
	}
	const profileId = HOST_UI_SMOKE_PROVIDER_TEXT_PROFILE[provider];
	if (profileId) {
		return resolveHostUiModelProfilePrimary(profileId);
	}
	return `${DEFAULT_HOST_UI_SMOKE_MODEL_ID}::${provider}`;
}

export function getHostUiSmokeModelKind(): "provider" | "wrapped" {
	return process.env.COPILOT_BRO_UI_SMOKE_MODEL_KIND?.trim().toLowerCase() === "wrapped" ? "wrapped" : "provider";
}

function getHostUiSmokeWrappedRuntimeModelId(): string | undefined {
	const preferredVendor = process.env.COPILOT_BRO_UI_SMOKE_WRAPPED_VENDOR?.trim().toLowerCase();
	const preferredId = process.env.COPILOT_BRO_UI_SMOKE_WRAPPED_ID?.trim();
	const wrappedModels = getCachedWrappedLanguageModelConfigs();
	const match = (preferredVendor || preferredId)
		? wrappedModels.find((model) => {
			if (preferredVendor && (model.wrappedLanguageModelVendor ?? model.provider).trim().toLowerCase() !== preferredVendor) {
				return false;
			}
			if (preferredId && model.wrappedLanguageModelId?.trim() !== preferredId) {
				return false;
			}
			return true;
		})
		: [...wrappedModels].sort(compareHostUiSmokeWrappedModels)[0];
	return match ? getRuntimeModelId(match) : undefined;
}

function compareHostUiSmokeWrappedModels(left: { wrappedLanguageModelVendor?: string; provider: string; wrappedLanguageModelId?: string }, right: { wrappedLanguageModelVendor?: string; provider: string; wrappedLanguageModelId?: string }): number {
	const vendorOrder = ["copilot", "github.copilot", "github", "copilotcli", "claude-code"];
	const modelOrder = ["gpt-4.1", "gpt-4o", "gpt-4o-mini", "gpt-5.4", "gpt-5.4-mini", "gpt-5-mini", "gpt-5.2", "gpt-5.2-codex", "gpt-5.3-codex", "claude-sonnet-4.6", "claude-sonnet-4.5", "claude-haiku-4.5", "gemini-2.5-pro", "gemini-3.1-pro-preview", "gemini-3-flash-preview", "auto", "copilot-fast"];
	const leftVendor = (left.wrappedLanguageModelVendor ?? left.provider).trim().toLowerCase();
	const rightVendor = (right.wrappedLanguageModelVendor ?? right.provider).trim().toLowerCase();
	const leftRank = vendorOrder.indexOf(leftVendor);
	const rightRank = vendorOrder.indexOf(rightVendor);
	if (leftRank !== rightRank) {
		return (leftRank < 0 ? Number.MAX_SAFE_INTEGER : leftRank) - (rightRank < 0 ? Number.MAX_SAFE_INTEGER : rightRank);
	}
	const leftModelId = left.wrappedLanguageModelId ?? "";
	const rightModelId = right.wrappedLanguageModelId ?? "";
	const leftModelRank = modelOrder.indexOf(leftModelId);
	const rightModelRank = modelOrder.indexOf(rightModelId);
	if (leftModelRank !== rightModelRank) {
		return (leftModelRank < 0 ? Number.MAX_SAFE_INTEGER : leftModelRank) - (rightModelRank < 0 ? Number.MAX_SAFE_INTEGER : rightModelRank);
	}
	return leftModelId.localeCompare(rightModelId);
}

export async function getHostUiSmokeModelSelector(): Promise<{ vendor: "extendedModels"; id: string; family?: string } | undefined> {
	if (getHostUiSmokeModelKind() === "wrapped") {
		if (refreshHostUiSmokeWrappedModels) {
			await refreshHostUiSmokeWrappedModels();
		} else {
			await refreshWrappedLanguageModelConfigs(extensionSmokeLogger());
		}
		await delay(200);
		logHostUiSmokeWrappedModels();
		const runtimeModelId = getHostUiSmokeRuntimeModelId();
		if (!runtimeModelId) {
			return undefined;
		}
		extensionSmokeLogger()?.info("host-ui-smoke.wrapped.model.selected", { runtimeModelId });
		return {
			vendor: "extendedModels",
			id: runtimeModelId
		} as const;
	}
	const runtimeModelId = getHostUiSmokeRuntimeModelId();
	if (!runtimeModelId) {
		return undefined;
	}
	return {
		vendor: "extendedModels",
		id: runtimeModelId,
		family: "oai-compatible"
	} as const;
}

function logHostUiSmokeWrappedModels(): void {
	const wrappedModels = getCachedWrappedLanguageModelConfigs().map((model) => ({
		runtimeModelId: getRuntimeModelId(model),
		vendor: model.wrappedLanguageModelVendor ?? model.provider,
		wrappedLanguageModelId: model.wrappedLanguageModelId,
		displayName: model.displayName ?? model.id,
		family: model.family
	}));
	const snapshot = JSON.stringify(wrappedModels);
	if (snapshot === lastHostUiSmokeWrappedSnapshot) {
		return;
	}
	lastHostUiSmokeWrappedSnapshot = snapshot;
	extensionSmokeLogger()?.info("host-ui-smoke.wrapped.models.available", { models: wrappedModels });
}

export function getHostUiSmokePrompt(): string {
	return process.env.COPILOT_BRO_UI_SMOKE_PROMPT?.trim() || HOST_UI_SMOKE_PROMPT;
}

