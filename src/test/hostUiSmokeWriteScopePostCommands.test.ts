import test from "node:test";
import assert from "node:assert/strict";
import {
	CONFIG_PANEL_POST_COMMANDS_REQUIRING_CONFIG_WRITE_SCOPE,
	configPanelPostCommandRequiresConfigWriteScope
} from "../ui/configPanelWriteScopePostCommands";

test("CONFIG_PANEL_POST_COMMANDS_REQUIRING_CONFIG_WRITE_SCOPE is sorted and unique", () => {
	const arr = [...CONFIG_PANEL_POST_COMMANDS_REQUIRING_CONFIG_WRITE_SCOPE];
	const sorted = [...arr].sort((a, b) => a.localeCompare(b));
	assert.deepEqual(arr, sorted);
	assert.equal(new Set(arr).size, arr.length);
});

test("configPanelPostCommandRequiresConfigWriteScope covers all persistence-related panel commands", () => {
	for (const cmd of CONFIG_PANEL_POST_COMMANDS_REQUIRING_CONFIG_WRITE_SCOPE) {
		assert.equal(configPanelPostCommandRequiresConfigWriteScope(cmd), true, cmd);
	}
	assert.equal(configPanelPostCommandRequiresConfigWriteScope("rememberEditorSelection"), false);
	assert.equal(configPanelPostCommandRequiresConfigWriteScope("openSettings"), false);
	assert.equal(configPanelPostCommandRequiresConfigWriteScope("setLanguage"), false);
	assert.equal(configPanelPostCommandRequiresConfigWriteScope("setConfigWriteScope"), false);
	assert.equal(configPanelPostCommandRequiresConfigWriteScope("saveModel"), true);
	assert.equal(configPanelPostCommandRequiresConfigWriteScope("savePhase1Section"), true);
	assert.equal(configPanelPostCommandRequiresConfigWriteScope("hostUiSmokeSaveModel"), true);
});
