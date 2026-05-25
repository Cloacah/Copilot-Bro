import test from "node:test";
import assert from "node:assert/strict";
import {
	normalizeDefaultSaveScope,
	readMergedCustomModelsFromInspect,
	resolveFieldWriteTarget,
	resolveModelRuntimeWriteTarget,
	resolveModelsConfigWriteTarget,
	scopeLayerDefinesRootField,
	SCOPED_CONFIG_ROOT_FIELD,
	upsertModelConfig
} from "../ui/configPanelPersistence";

test("normalizeDefaultSaveScope treats missing value as global default", () => {
	assert.equal(normalizeDefaultSaveScope(undefined), "global");
	assert.equal(normalizeDefaultSaveScope(""), "global");
	assert.equal(normalizeDefaultSaveScope("global"), "global");
	assert.equal(normalizeDefaultSaveScope("workspace"), "workspace");
	assert.equal(normalizeDefaultSaveScope("auto"), "workspace");
});

test("resolveModelsConfigWriteTarget uses field ownership for the models key", () => {
	assert.equal(
		resolveModelsConfigWriteTarget({ workspaceFolderValue: [] }, true),
		"global"
	);
	assert.equal(resolveModelsConfigWriteTarget({ workspaceValue: [] }, true), "global");
	assert.equal(resolveModelsConfigWriteTarget({ globalValue: [] }, true), "global");
	assert.equal(
		resolveModelsConfigWriteTarget(
			{ globalValue: [{ id: "a", provider: "p" }] },
			true
		),
		"global"
	);
	assert.equal(resolveModelsConfigWriteTarget(undefined, true), "global");
	assert.equal(resolveModelsConfigWriteTarget(undefined, false), "global");
	assert.equal(
		resolveModelsConfigWriteTarget({ workspaceFolderValue: [] }, true, "workspace"),
		"workspace"
	);
});

test("resolveFieldWriteTarget honors default save scope preference", () => {
	assert.equal(
		resolveFieldWriteTarget(
			{ globalValue: { kimi: "moonshot-global" } },
			"kimi",
			"global",
			true
		),
		"global"
	);
	assert.equal(
		resolveFieldWriteTarget(
			undefined,
			"kimi",
			"workspace",
			true
		),
		"workspace"
	);
});

test("scopeLayerDefinesRootField ignores empty object and array placeholders", () => {
	assert.equal(scopeLayerDefinesRootField(undefined), false);
	assert.equal(scopeLayerDefinesRootField({}), false);
	assert.equal(scopeLayerDefinesRootField([]), false);
	assert.equal(scopeLayerDefinesRootField({ enabled: true }), true);
});

test("resolveFieldWriteTarget for root uses whole-key presence", () => {
	assert.equal(
		resolveFieldWriteTarget(
			{ globalValue: { kimi: "a" }, workspaceValue: { qwen: "b" } },
			SCOPED_CONFIG_ROOT_FIELD,
			"workspace",
			true
		),
		"workspace"
	);
	assert.equal(
		resolveFieldWriteTarget(
			{ workspaceFolderValue: {}, globalValue: { enabled: true } },
			SCOPED_CONFIG_ROOT_FIELD,
			"workspace",
			true
		),
		"global"
	);
});

test("readMergedCustomModelsFromInspect merges by runtime id with higher scope winning", () => {
	const merged = readMergedCustomModelsFromInspect({
		globalValue: [
			{ id: "a", provider: "p" },
			{ id: "b", provider: "p" }
		],
		workspaceValue: [{ id: "a", provider: "p", displayName: "from-ws" }]
	});
	assert.equal(merged.length, 2);
	const a = merged.find((m) => (m as { id?: string }).id === "a") as { displayName?: string };
	assert.equal(a.displayName, "from-ws");
});

test("resolveModelRuntimeWriteTarget picks highest layer that lists the runtime id", () => {
	const inspect = {
		globalValue: [{ id: "x", provider: "p" }],
		workspaceValue: [{ id: "x", provider: "p", displayName: "ws" }]
	};
	assert.equal(
		resolveModelRuntimeWriteTarget(inspect, "x::p", "workspace", true),
		"workspace"
	);
	assert.equal(
		resolveModelRuntimeWriteTarget(inspect, "y::p", "workspace", true),
		"workspace"
	);
});

test("upsertModelConfig replaces existing runtime id and preserves null visionProxyModelId", () => {
	const current = [
		{
			id: "deepseek-v4-flash",
			provider: "deepseek",
			displayName: "old",
			visionProxyModelId: "gpt-4.1"
		}
	];
	const updated = {
		id: "deepseek-v4-flash",
		provider: "deepseek",
		displayName: "new",
		visionProxyModelId: null
	};
	const next = upsertModelConfig(current, updated);
	assert.equal(next.length, 1);
	assert.deepEqual(next[0], updated);
});

test("upsertModelConfig keeps latest override across consecutive updates", () => {
	const first = upsertModelConfig([], {
		id: "deepseek-v4-flash",
		provider: "deepseek",
		displayName: "first",
		temperature: 0.2,
		visionProxyModelId: "gpt-4.1"
	});
	const second = upsertModelConfig(first, {
		id: "deepseek-v4-flash",
		provider: "deepseek",
		displayName: "second",
		temperature: 0.8,
		visionProxyModelId: null
	});
	assert.equal(second.length, 1);
	assert.equal((second[0] as { displayName?: string }).displayName, "second");
	assert.equal((second[0] as { temperature?: number }).temperature, 0.8);
	assert.equal((second[0] as { visionProxyModelId?: string | null }).visionProxyModelId, null);
});
