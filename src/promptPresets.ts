import * as path from "node:path";
import * as vscode from "vscode";
import type { Logger } from "./logger";
import type { ExtensionSettings, OpenAIMessage } from "./types";

export const PROMPT_PRESET_GLOB = "*.copilot-bro.prompt.md";
const SELECTED_PRESET_KEY = "extendedModels.promptPresets.selectedId";

export interface PromptPresetApplyOptions {
	readonly logger?: Pick<Logger, "info">;
}

export interface PromptPreset {
	id: string;
	label: string;
	source: "built-in" | "workspace" | "global";
	uri: vscode.Uri;
}

export async function prependSelectedPromptPreset(
	context: vscode.ExtensionContext,
	settings: ExtensionSettings,
	messages: OpenAIMessage[],
	options?: PromptPresetApplyOptions
): Promise<OpenAIMessage[]> {
	const selectedId = getSelectedPromptPresetId(context, settings);
	if (!selectedId) {
		return messages;
	}
	const preset = (await listPromptPresets(context)).find((item) => item.id === selectedId);
	const presetContent = preset ? await readPromptPreset(preset.uri) : undefined;
	if (!preset || !presetContent?.trim()) {
		return messages;
	}
	const content = [
		`Copilot Bro preset prompt: ${preset.label}`,
		`Source: ${preset.source}`,
		"",
		presetContent.trim()
	].join("\n");
	options?.logger?.info("prompt.preset.applied", {
		presetId: preset.id,
		label: preset.label,
		source: preset.source,
		contentLength: content.length
	});
	return [
		{
			role: "system",
			content
		},
		...messages
	];
}

/** Host UI / automation: persist preset selection without QuickPick. */
export async function persistSelectedPromptPreset(
	context: vscode.ExtensionContext,
	presetId: string
): Promise<void> {
	const normalized = presetId.trim();
	await context.workspaceState.update(SELECTED_PRESET_KEY, normalized);
	const target = vscode.workspace.workspaceFolders?.length
		? vscode.ConfigurationTarget.Workspace
		: vscode.ConfigurationTarget.Global;
	await vscode.workspace.getConfiguration("extendedModels").update(
		"promptPresets",
		{ selectedId: normalized },
		target
	);
}

export async function resolveSelectedPromptPresetContent(
	context: vscode.ExtensionContext,
	settings: ExtensionSettings
): Promise<string | undefined> {
	const selectedId = getSelectedPromptPresetId(context, settings);
	if (!selectedId) {
		return undefined;
	}
	const preset = (await listPromptPresets(context)).find((item) => item.id === selectedId);
	if (!preset) {
		return undefined;
	}
	const content = await readPromptPreset(preset.uri);
	if (!content.trim()) {
		return undefined;
	}
	return [
		`Copilot Bro preset prompt: ${preset.label}`,
		`Source: ${preset.source}`,
		"",
		content.trim()
	].join("\n");
}

export async function selectPromptPreset(context: vscode.ExtensionContext): Promise<void> {
	const presets = await listPromptPresets(context);
	const current = context.workspaceState.get<string>(SELECTED_PRESET_KEY, "");
	const items = [
		{
			label: "$(circle-slash) None",
			description: "Do not prepend a Copilot Bro preset prompt",
			id: ""
		},
		...presets.map((preset) => ({
			label: preset.label,
			description: preset.source,
			detail: preset.id === current ? "Current" : preset.uri.fsPath,
			id: preset.id
		}))
	];
	const picked = await vscode.window.showQuickPick(items, {
		title: "Copilot Bro: Select Prompt Preset",
		placeHolder: "Choose the preset prompt prepended to extension-model requests",
		matchOnDescription: true,
		matchOnDetail: true
	});
	if (!picked) {
		return;
	}
	await persistSelectedPromptPreset(context, picked.id);
	vscode.window.showInformationMessage(picked.id ? `Copilot Bro prompt preset selected: ${picked.label}` : "Copilot Bro prompt preset disabled.");
}

export async function openGlobalPromptPresetFolder(context: vscode.ExtensionContext): Promise<void> {
	const folder = getGlobalPromptFolder(context);
	await vscode.workspace.fs.createDirectory(folder);
	await vscode.commands.executeCommand("revealFileInOS", folder);
}

export async function listPromptPresets(context: vscode.ExtensionContext): Promise<PromptPreset[]> {
	const [builtIn, global, workspace] = await Promise.all([
		readPromptDirectory(vscode.Uri.joinPath(context.extensionUri, "resources", "prompts"), "built-in"),
		readPromptDirectory(getGlobalPromptFolder(context), "global"),
		readWorkspacePromptPresets()
	]);
	return dedupePresets([...workspace, ...global, ...builtIn]);
}

export function getSelectedPromptPresetId(context: vscode.ExtensionContext, settings: ExtensionSettings): string {
	return context.workspaceState.get<string>(SELECTED_PRESET_KEY, "") || settings.promptPresets.selectedId;
}

async function readWorkspacePromptPresets(): Promise<PromptPreset[]> {
	const files = await vscode.workspace.findFiles(`.copilot-bro/prompts/${PROMPT_PRESET_GLOB}`);
	return files.map((uri) => createPromptPreset(uri, "workspace"));
}

async function readPromptDirectory(uri: vscode.Uri, source: PromptPreset["source"]): Promise<PromptPreset[]> {
	try {
		const entries = await vscode.workspace.fs.readDirectory(uri);
		return entries
			.filter(([name, type]) => type === vscode.FileType.File && name.endsWith(".copilot-bro.prompt.md"))
			.map(([name]) => createPromptPreset(vscode.Uri.joinPath(uri, name), source));
	} catch {
		return [];
	}
}

async function readPromptPreset(uri: vscode.Uri): Promise<string> {
	const bytes = await vscode.workspace.fs.readFile(uri);
	return new TextDecoder().decode(bytes);
}

function createPromptPreset(uri: vscode.Uri, source: PromptPreset["source"]): PromptPreset {
	const base = path.basename(uri.fsPath, ".copilot-bro.prompt.md");
	return {
		id: `${source}:${base}`,
		label: titleCase(base),
		source,
		uri
	};
}

function dedupePresets(presets: PromptPreset[]): PromptPreset[] {
	const out = new Map<string, PromptPreset>();
	for (const preset of presets) {
		out.set(preset.id, preset);
	}
	return Array.from(out.values()).sort((a, b) => `${a.source}:${a.label}`.localeCompare(`${b.source}:${b.label}`));
}

function getGlobalPromptFolder(context: vscode.ExtensionContext): vscode.Uri {
	return vscode.Uri.joinPath(context.globalStorageUri, "prompts");
}

function titleCase(value: string): string {
	return value
		.split(/[-_\s]+/g)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}
