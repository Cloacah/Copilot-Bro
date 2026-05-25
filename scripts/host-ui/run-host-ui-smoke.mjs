#!/usr/bin/env node
/**
 * Cross-platform Host UI smoke launcher (sets env then runs compiled driver).
 *
 * Usage:
 *   node scripts/run-host-ui-smoke.mjs [full]
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const profile = (process.argv[2] ?? "").trim().toLowerCase();
const driver = path.join(root, "out", "e2e", "driver", "hostUiSmoke.js");

const env = { ...process.env };
if (profile === "full") {
	env.COPILOT_BRO_UI_SMOKE_E2E = "all";
}

const result = spawnSync(process.execPath, [driver], {
	cwd: root,
	env,
	stdio: "inherit"
});

process.exit(result.status ?? 1);
