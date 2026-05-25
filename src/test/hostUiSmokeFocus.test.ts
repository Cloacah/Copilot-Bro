import test from "node:test";
import assert from "node:assert/strict";
import { isSmokeWindowForegroundMatch, createSmokeFocusKeeper } from "../e2e/driver/hostUiSmokeFocus";

test("isSmokeWindowForegroundMatch accepts Visual Studio Code foreground", () => {
	assert.equal(isSmokeWindowForegroundMatch("README.md - HostUiSmoke - Visual Studio Code", "HostUiSmokeWorkspace"), true);
});

test("isSmokeWindowForegroundMatch accepts overlapping workspace titles", () => {
	assert.equal(isSmokeWindowForegroundMatch("HostUiSmokeWorkspace-123", "HostUiSmokeWorkspace-123 - Visual Studio Code"), true);
});

test("isSmokeWindowForegroundMatch rejects unrelated foreground", () => {
	assert.equal(isSmokeWindowForegroundMatch("Cursor - plan.md", "HostUiSmoke - Visual Studio Code"), false);
});

test("createSmokeFocusKeeper recovers when foreground is wrong", async () => {
	const calls: string[] = [];
	const keeper = createSmokeFocusKeeper(
		{ getTitle: () => "HostUiSmoke - Visual Studio Code" } as import("node-window-manager").Window,
		"test-wait",
		{
			getForegroundTitle: () => "Cursor",
			focusWindow: async () => {
				calls.push("focus");
			}
		}
	);
	await keeper.maybeRecover(true);
	assert.deepEqual(calls, ["focus"]);
});

test("createSmokeFocusKeeper skips recovery when VS Code is already foreground", async () => {
	const calls: string[] = [];
	const keeper = createSmokeFocusKeeper(
		{ getTitle: () => "HostUiSmoke - Visual Studio Code" } as import("node-window-manager").Window,
		"test-wait",
		{
			getForegroundTitle: () => "HostUiSmoke - Visual Studio Code",
			focusWindow: async () => {
				calls.push("focus");
			}
		}
	);
	await keeper.maybeRecover();
	assert.deepEqual(calls, []);
});
