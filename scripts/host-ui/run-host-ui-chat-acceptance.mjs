#!/usr/bin/env node
/**
 * Host UI Chat acceptance: GitHub login preflight + integration chat matrix.
 * Sets stable env then runs the compiled driver (Windows + local VS Code required).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const driver = path.join(root, "out", "e2e", "driver", "hostUiSmoke.js");

const env = {
	...process.env,
	COPILOT_BRO_UI_SMOKE_E2E: "github-chat-login,chat-scenarios",
	COPILOT_BRO_UI_SMOKE_CONFIG_PANEL: "0",
	COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION: process.env.COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION?.trim() || "1",
	COPILOT_BRO_UI_SMOKE_CHAT_MODE: process.env.COPILOT_BRO_UI_SMOKE_CHAT_MODE?.trim() || "ask",
	COPILOT_BRO_UI_SMOKE_AUTO_RUN_CHAT_SUITE: process.env.COPILOT_BRO_UI_SMOKE_AUTO_RUN_CHAT_SUITE?.trim() || "1",
	COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION_NO_MAX_WAIT: process.env.COPILOT_BRO_UI_SMOKE_CHAT_INTEGRATION_NO_MAX_WAIT?.trim() || "1"
};

const compile = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "compile"], {
	cwd: root,
	env,
	stdio: "inherit",
	shell: process.platform === "win32"
});
if (compile.status !== 0) {
	process.exit(compile.status ?? 1);
}

const result = spawnSync(process.execPath, [driver], {
	cwd: root,
	env,
	stdio: "inherit"
});

process.exit(result.status ?? 1);
