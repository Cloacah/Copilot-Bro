import test from "node:test";
import assert from "node:assert/strict";
import {
	emptyHostUiSmokeModelState,
	parseHostUiSmokeConfigResult,
	parseHostUiSmokeModelState,
	parseHostUiSmokeModelVersionUi,
	parseHostUiSmokeProviderEndpointUi,
	parseHostUiSmokeQwenCatalogUi
} from "../ui/hostUiSmokeConfigResult";
import { QWEN_HOST_UI_CONTRACT } from "../config/qwenCatalogContract";

test("parseHostUiSmokeConfigResult: empty input yields ok false and default error", () => {
	const r = parseHostUiSmokeConfigResult(undefined);
	assert.equal(r.ok, false);
	assert.deepEqual(r.initial, emptyHostUiSmokeModelState());
	assert.match(r.error ?? "", /empty/);
});

test("parseHostUiSmokeConfigResult: ok true only when record.ok is strictly true", () => {
	assert.equal(parseHostUiSmokeConfigResult({ ok: true, initial: {} }).ok, true);
	assert.equal(parseHostUiSmokeConfigResult({ ok: "true", initial: {} }).ok, false);
	assert.equal(parseHostUiSmokeConfigResult({ ok: 1, initial: {} }).ok, false);
});

test("parseHostUiSmokeModelState: tolerates partial and non-object", () => {
	assert.deepEqual(parseHostUiSmokeModelState(null), emptyHostUiSmokeModelState());
	assert.deepEqual(parseHostUiSmokeModelState({ displayName: 1 }), { displayName: "", temperature: "" });
	assert.deepEqual(parseHostUiSmokeModelState({ displayName: "x", temperature: "0.5" }), {
		displayName: "x",
		temperature: "0.5"
	});
});

test("parseHostUiSmokeProviderEndpointUi: requires object", () => {
	assert.equal(parseHostUiSmokeProviderEndpointUi(undefined), undefined);
	const u = parseHostUiSmokeProviderEndpointUi({
		rowVisible: true,
		profileId: "dashscope-cn",
		baseUrlBefore: "",
		baseUrlAfter: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		persistedProfileId: "dashscope-cn",
		savedViaSaveButton: true
	});
	assert.equal(u?.rowVisible, true);
	assert.equal(u?.savedViaProfileChange, false);
});

test("parseHostUiSmokeModelVersionUi: booleans strict", () => {
	const v = parseHostUiSmokeModelVersionUi({
		rowVisible: true,
		familyKey: QWEN_HOST_UI_CONTRACT.qwen3MaxFamilyKey,
		versionBefore: "",
		versionAfter: QWEN_HOST_UI_CONTRACT.qwen3MaxDefaultVersionId,
		customVersionId: "x",
		customAdded: "yes",
		customRemoved: true
	});
	assert.equal(v?.customAdded, false);
	assert.equal(v?.customRemoved, true);
});

test("parseHostUiSmokeQwenCatalogUi: numeric versionCount", () => {
	const q = parseHostUiSmokeQwenCatalogUi({ familyVisible: true, familyKey: "f", versionCount: "8", defaultVersionId: "id" });
	assert.equal(q?.versionCount, 0);
	const q2 = parseHostUiSmokeQwenCatalogUi({ familyVisible: true, familyKey: "f", versionCount: 8, defaultVersionId: "id" });
	assert.equal(q2?.versionCount, 8);
});

test("parseHostUiSmokeConfigResult: full happy path preserves nested UI evidence", () => {
	const r = parseHostUiSmokeConfigResult({
		ok: true,
		initial: { displayName: "a", temperature: "1" },
		afterSave: { displayName: "b", temperature: "1.4" },
		proState: { displayName: "c", temperature: "2" },
		roundtrip: { displayName: "b", temperature: "1.4" },
		restored: { displayName: "a", temperature: "1" },
		providerEndpointUi: {
			rowVisible: true,
			profileId: "dashscope-cn",
			baseUrlBefore: "x",
			baseUrlAfter: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			persistedProfileId: "dashscope-cn"
		},
		modelVersionUi: {
			rowVisible: true,
			familyKey: QWEN_HOST_UI_CONTRACT.qwen3MaxFamilyKey,
			versionBefore: "v0",
			versionAfter: "v1",
			customVersionId: "cid",
			customAdded: true,
			customRemoved: true
		},
		qwenCatalogUi: {
			familyVisible: true,
			familyKey: QWEN_HOST_UI_CONTRACT.vlOpenSourceFamilyKey,
			versionCount: QWEN_HOST_UI_CONTRACT.vlOpenSourceVersionCount,
			defaultVersionId: QWEN_HOST_UI_CONTRACT.vlOpenSourceDefaultVersionId
		}
	});
	assert.equal(r.ok, true);
	assert.equal(r.afterSave.temperature, "1.4");
	assert.equal(r.providerEndpointUi?.profileId, "dashscope-cn");
	assert.equal(r.modelVersionUi?.customAdded, true);
	assert.equal(r.qwenCatalogUi?.versionCount, 8);
});
