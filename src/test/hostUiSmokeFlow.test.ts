import test from "node:test";
import assert from "node:assert/strict";
import { getHostUiSmokeRequestPath, shouldRunConfigPanelSmoke, shouldRunPostChatLmApiAfterChat, shouldUseLanguageModelApiCommand } from "../e2e/driver/hostUiSmokeFlow";
import { parseHostUiSmokeE2eSuites } from "../e2e/hostUi/suites/e2eSuites";

test("host UI smoke defaults to real chat UI request path", () => {
	assert.equal(getHostUiSmokeRequestPath({}), "chat-ui");
	assert.equal(getHostUiSmokeRequestPath({ COPILOT_BRO_UI_SMOKE_REQUEST_PATH: "chat-ui" }), "chat-ui");
	assert.equal(getHostUiSmokeRequestPath({ COPILOT_BRO_UI_SMOKE_REQUEST_PATH: "bad-value" }), "chat-ui");
	assert.equal(shouldUseLanguageModelApiCommand("chat-ui"), false);
});

test("host UI smoke language model API path is explicit only", () => {
	assert.equal(getHostUiSmokeRequestPath({ COPILOT_BRO_UI_SMOKE_REQUEST_PATH: "lm-api" }), "lm-api");
	assert.equal(shouldUseLanguageModelApiCommand("lm-api"), true);
});

test("host UI smoke config panel follows E2E suite defaults with env overrides", () => {
	const all = parseHostUiSmokeE2eSuites({});
	assert.equal(shouldRunConfigPanelSmoke({}, all), true);
	assert.equal(shouldRunConfigPanelSmoke({ COPILOT_BRO_UI_SMOKE_CONFIG_PANEL: "0" }, all), false);
	assert.equal(shouldRunConfigPanelSmoke({ COPILOT_BRO_UI_SMOKE_CONFIG_PANEL: "1" }, all), true);
	const noConfig = parseHostUiSmokeE2eSuites({ COPILOT_BRO_UI_SMOKE_E2E: "chat-scenarios" });
	assert.equal(shouldRunConfigPanelSmoke({}, noConfig), false);
});

test("post-chat LM API phase defaults on for provider unless opted out", () => {
	assert.equal(shouldRunPostChatLmApiAfterChat({}, { hasMockServer: true, smokeModelKind: "provider" }), true);
	assert.equal(shouldRunPostChatLmApiAfterChat({}, { hasMockServer: false, smokeModelKind: "provider" }), true);
	assert.equal(shouldRunPostChatLmApiAfterChat({}, { hasMockServer: true, smokeModelKind: "wrapped" }), false);
});

test("post-chat LM API phase can be forced on or off", () => {
	assert.equal(shouldRunPostChatLmApiAfterChat({ COPILOT_BRO_UI_SMOKE_POST_CHAT_LM_API: "1" }, { hasMockServer: false, smokeModelKind: "provider" }), true);
	assert.equal(shouldRunPostChatLmApiAfterChat({ COPILOT_BRO_UI_SMOKE_POST_CHAT_LM_API: "0" }, { hasMockServer: true, smokeModelKind: "provider" }), false);
});
