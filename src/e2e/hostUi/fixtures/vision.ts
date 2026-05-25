import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const HOST_UI_SMOKE_TEST_BUTTON_HYDRATION_FILE = "按钮1.png";
export const HOST_UI_SMOKE_TEST_BUTTON_RESTORE_FILE = "按钮2.png";

export const HOST_UI_SMOKE_TEST_BUTTON_RELATIVE = path.join(
	"fixtures",
	"host-ui",
	"testButtons",
	HOST_UI_SMOKE_TEST_BUTTON_HYDRATION_FILE
);

export function resolveHostUiSmokeRepoRoot(env: Pick<NodeJS.ProcessEnv, string> = process.env): string {
	const fromEnv = env.COPILOT_BRO_UI_SMOKE_REPO_ROOT?.trim();
	if (fromEnv) {
		return path.resolve(fromEnv);
	}
	return path.resolve(__dirname, "..", "..", "..", "..");
}

export function resolveHostUiSmokeTestButtonPath(
	env: Pick<NodeJS.ProcessEnv, string> = process.env,
	fileName = HOST_UI_SMOKE_TEST_BUTTON_HYDRATION_FILE
): string {
	const explicit = env.COPILOT_BRO_UI_SMOKE_TEST_BUTTON_PATH?.trim();
	if (explicit && fileName === HOST_UI_SMOKE_TEST_BUTTON_HYDRATION_FILE) {
		return path.resolve(explicit);
	}
	const fixturesRoot = env.COPILOT_BRO_FIXTURES_ROOT?.trim();
	if (fixturesRoot) {
		return path.join(path.resolve(fixturesRoot), "host-ui", "testButtons", fileName);
	}
	return path.join(resolveHostUiSmokeRepoRoot(env), "fixtures", "host-ui", "testButtons", fileName);
}

export async function assertHostUiSmokeTestButtonExists(
	env: Pick<NodeJS.ProcessEnv, string> = process.env,
	fileName = HOST_UI_SMOKE_TEST_BUTTON_HYDRATION_FILE
): Promise<string> {
	const assetPath = resolveHostUiSmokeTestButtonPath(env, fileName);
	await access(assetPath);
	return assetPath;
}

export const HOST_UI_SMOKE_CHAT_SCREENSHOT_BENCHMARK_RELATIVE = path.join(
	"src",
	"test",
	"fixtures",
	"chat-screenshot-benchmark.png"
);

export async function readHostUiSmokeChatScreenshotBenchmarkBytes(
	env: Pick<NodeJS.ProcessEnv, string> = process.env
): Promise<Uint8Array> {
	const root = resolveHostUiSmokeRepoRoot(env);
	const bytes = await readFile(path.join(root, HOST_UI_SMOKE_CHAT_SCREENSHOT_BENCHMARK_RELATIVE));
	return Uint8Array.from(bytes);
}

export async function assertHostUiSmokeChatScreenshotBenchmarkExists(
	env: Pick<NodeJS.ProcessEnv, string> = process.env
): Promise<string> {
	const root = resolveHostUiSmokeRepoRoot(env);
	const assetPath = path.join(root, HOST_UI_SMOKE_CHAT_SCREENSHOT_BENCHMARK_RELATIVE);
	await access(assetPath);
	return assetPath;
}

export const HOST_UI_SMOKE_BUTTON_PATH_PLACEHOLDER = "{{HOST_UI_SMOKE_BUTTON_PATH}}";

export function expandHostUiSmokeIntegrationPrompt(prompt: string, env: Pick<NodeJS.ProcessEnv, string> = process.env): string {
	if (!prompt.includes(HOST_UI_SMOKE_BUTTON_PATH_PLACEHOLDER)) {
		return prompt;
	}
	return prompt.replaceAll(HOST_UI_SMOKE_BUTTON_PATH_PLACEHOLDER, resolveHostUiSmokeTestButtonPath(env));
}
