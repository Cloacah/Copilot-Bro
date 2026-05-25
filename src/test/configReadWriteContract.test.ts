/**
 * Contract tests: scoped configuration read/write (plan-aligned).
 *
 * Read: shallow-merge object fields in order global → workspace → workspaceFolder (later wins).
 * `models` array: merge rows by runtime id with the same layer order.
 *
 * Write target for a field: the last layer in that merge order that materially defines the field;
 * if none, use {@link resolveDefaultSaveTarget} from the user's "default save scope" preference.
 *
 * Root / whole-key: empty `{}` or `[]` does not count as defined (placeholders must not steal ownership).
 *
 * Missing webview `configWriteScope` normalizes via {@link normalizeDefaultSaveScope} (undefined → global).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProviderEndpointsConfig } from "../config/providerEndpoints";
import {
	buildScopedFieldWrite,
	buildScopedSectionPatch,
	normalizeDefaultSaveScope,
	readMergedCustomModelsFromInspect,
	readMergedObjectFromInspect,
	readMergedSectionFromInspect,
	resolveDefaultSaveTarget,
	resolveFieldWriteTarget,
	resolveModelRuntimeWriteTarget,
	scopeLayerDefinesField,
	scopeLayerDefinesRootField,
	SCOPED_CONFIG_ROOT_FIELD
} from "../ui/configPanelPersistence";

test("normalizeDefaultSaveScope: only explicit workspace/auto select workspace file semantics", () => {
	assert.equal(normalizeDefaultSaveScope(undefined), "global");
	assert.equal(normalizeDefaultSaveScope(null), "global");
	assert.equal(normalizeDefaultSaveScope("workspace"), "workspace");
	assert.equal(normalizeDefaultSaveScope("auto"), "workspace");
	assert.equal(normalizeDefaultSaveScope("global"), "global");
	assert.equal(normalizeDefaultSaveScope("WORKSPACE"), "global");
});

test("resolveDefaultSaveTarget: workspace preference maps to VS Code Workspace when folders exist", () => {
	assert.equal(resolveDefaultSaveTarget("global", true), "global");
	assert.equal(resolveDefaultSaveTarget("global", false), "global");
	assert.equal(resolveDefaultSaveTarget("workspace", true), "workspace");
	assert.equal(resolveDefaultSaveTarget("workspace", false), "global");
});

test("readMergedObjectFromInspect: later layer overwrites same keys (providerEndpoints-style)", () => {
	const merged = readMergedObjectFromInspect(
		{
			globalValue: { kimi: "moonshot-global", qwen: "dashscope-intl" },
			workspaceValue: { qwen: "dashscope-cn" },
			workspaceFolderValue: { kimi: "moonshot-cn" }
		},
		normalizeProviderEndpointsConfig
	);
	assert.equal(merged.kimi, "moonshot-cn");
	assert.equal(merged.qwen, "dashscope-cn");
});

test("readMergedSectionFromInspect: visionAgent-style shallow merge", () => {
	const merged = readMergedSectionFromInspect({
		globalValue: { enabled: true, keepAliveMs: 100 },
		workspaceValue: { keepAliveMs: 200 },
		workspaceFolderValue: { enabled: false }
	});
	assert.equal(merged.enabled, false);
	assert.equal(merged.keepAliveMs, 200);
});

test("readMergedSectionFromInspect: all inspect entries undefined falls back to normalize(undefined)", () => {
	const merged = readMergedSectionFromInspect(undefined);
	assert.deepEqual(merged, {});
});

test("resolveFieldWriteTarget: field owner is last layer that defines the key (merge winner supplies write layer)", () => {
	assert.equal(
		resolveFieldWriteTarget(
			{
				globalValue: { kimi: "moonshot-global" },
				workspaceValue: { qwen: "dashscope-cn" }
			},
			"kimi",
			"workspace",
			true
		),
		"global"
	);
	assert.equal(
		resolveFieldWriteTarget(
			{
				globalValue: { kimi: "moonshot-global" },
				workspaceValue: { kimi: "moonshot-cn", qwen: "dashscope-cn" }
			},
			"kimi",
			"workspace",
			true
		),
		"workspace"
	);
});

test("resolveFieldWriteTarget: undefined field uses default preference (global vs workspace)", () => {
	assert.equal(resolveFieldWriteTarget(undefined, "orphan", "global", true), "global");
	assert.equal(resolveFieldWriteTarget(undefined, "orphan", "workspace", true), "workspace");
	assert.equal(resolveFieldWriteTarget(undefined, "orphan", "workspace", false), "global");
});

test("resolveFieldWriteTarget: empty folder object does not own keys defined only in global", () => {
	assert.equal(
		resolveFieldWriteTarget(
			{
				globalValue: { enabled: true },
				workspaceFolderValue: {}
			},
			"enabled",
			"workspace",
			true
		),
		"global"
	);
});

test("resolveFieldWriteTarget: workspaceFolder wins over workspace for same field", () => {
	assert.equal(
		resolveFieldWriteTarget(
			{
				globalValue: { x: 1 },
				workspaceValue: { x: 2 },
				workspaceFolderValue: { x: 3 }
			},
			"x",
			"global",
			true
		),
		"workspaceFolder"
	);
});

test("resolveFieldWriteTarget: SCOPED_CONFIG_ROOT_FIELD ignores empty placeholder layers", () => {
	assert.equal(
		resolveFieldWriteTarget(
			{ workspaceFolderValue: {}, globalValue: { a: 1 } },
			SCOPED_CONFIG_ROOT_FIELD,
			"workspace",
			true
		),
		"global"
	);
	assert.equal(
		resolveFieldWriteTarget(
			{ workspaceValue: [], workspaceFolderValue: { x: 1 } },
			SCOPED_CONFIG_ROOT_FIELD,
			"global",
			true
		),
		"workspaceFolder"
	);
});

test("scopeLayerDefinesField: object key presence; root uses scopeLayerDefinesRootField", () => {
	assert.equal(scopeLayerDefinesField({ a: 1 }, "a"), true);
	assert.equal(scopeLayerDefinesField({ a: 1 }, "b"), false);
	assert.equal(scopeLayerDefinesField({}, SCOPED_CONFIG_ROOT_FIELD), false);
	assert.equal(scopeLayerDefinesField({ x: 1 }, SCOPED_CONFIG_ROOT_FIELD), true);
});

test("readMergedCustomModelsFromInspect: folder runtime row wins over workspace and global", () => {
	const merged = readMergedCustomModelsFromInspect({
		globalValue: [{ id: "m", provider: "p", temperature: 0.1 }],
		workspaceValue: [{ id: "m", provider: "p", temperature: 0.2 }],
		workspaceFolderValue: [{ id: "m", provider: "p", temperature: 0.3 }]
	});
	assert.equal(merged.length, 1);
	assert.equal((merged[0] as { temperature?: number }).temperature, 0.3);
});

test("readMergedCustomModelsFromInspect: all inspect undefined yields empty list", () => {
	assert.deepEqual(readMergedCustomModelsFromInspect(undefined), []);
});

test("resolveModelRuntimeWriteTarget: new runtime id uses resolveDefaultSaveTarget", () => {
	assert.equal(resolveModelRuntimeWriteTarget(undefined, "new::p", "global", true), "global");
	assert.equal(resolveModelRuntimeWriteTarget(undefined, "new::p", "workspace", true), "workspace");
	assert.equal(resolveModelRuntimeWriteTarget(undefined, "new::p", "workspace", false), "global");
});

test("resolveModelRuntimeWriteTarget: owner is last layer that lists the runtime id", () => {
	const inspect = {
		globalValue: [{ id: "m", provider: "p", t: 1 }],
		workspaceValue: [{ id: "m", provider: "p", t: 2 }],
		workspaceFolderValue: [{ id: "m", provider: "p", t: 3 }]
	};
	assert.equal(resolveModelRuntimeWriteTarget(inspect, "m::p", "global", true), "workspaceFolder");
});

test("resolveModelRuntimeWriteTarget: empty arrays do not contain the model — fall back to default", () => {
	assert.equal(
		resolveModelRuntimeWriteTarget({ workspaceValue: [], globalValue: [] }, "x::p", "global", true),
		"global"
	);
});

test("buildScopedFieldWrite: patches single field at owner layer without dropping siblings", () => {
	const { value, target } = buildScopedFieldWrite(
		{
			globalValue: { kimi: "moonshot-global", qwen: "dashscope-intl" },
			workspaceValue: { kimi: "moonshot-cn", qwen: "dashscope-cn" }
		},
		"kimi",
		"moonshot-global",
		"global",
		true,
		(input) => ({ ...(input as Record<string, string>) })
	);
	assert.equal(target, "workspace");
	assert.equal(value.kimi, "moonshot-global");
	assert.equal(value.qwen, "dashscope-cn");
});

test("buildScopedFieldWrite: new field when only global has other keys writes to default global layer", () => {
	const { value, target } = buildScopedFieldWrite(
		{ globalValue: { kimi: "g" } },
		"qwen",
		"cn",
		"global",
		true,
		(input) => ({ ...(input as Record<string, string>) })
	);
	assert.equal(target, "global");
	assert.equal(value.kimi, "g");
	assert.equal(value.qwen, "cn");
});

test("buildScopedFieldWrite: removing field uses owner layer record only (no cross-layer merge on write)", () => {
	const { value, target } = buildScopedFieldWrite(
		{
			globalValue: { a: 1, b: 2 },
			workspaceValue: { b: 3 }
		},
		"b",
		undefined,
		"global",
		true,
		(input) => ({ ...(input as Record<string, unknown>) })
	);
	assert.equal(target, "workspace");
	assert.deepEqual(value, {});
});

test("buildScopedFieldWrite: __root__ replaces entire object at owner target", () => {
	const { target, value } = buildScopedFieldWrite(
		{ workspaceValue: { x: 1 } },
		SCOPED_CONFIG_ROOT_FIELD,
		{ y: 2 },
		"global",
		true,
		(input) => asPlainRecord(input)
	);
	assert.equal(target, "workspace");
	assert.deepEqual(value, { y: 2 });
});

test("buildScopedSectionPatch: whole-section patch target follows root ownership", () => {
	const { target } = buildScopedSectionPatch(
		{ globalValue: { enabled: true } },
		{ enabled: false },
		"workspace",
		true
	);
	assert.equal(target, "global");
});

function asPlainRecord(input: unknown): Record<string, unknown> {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {};
	}
	return { ...(input as Record<string, unknown>) };
}
