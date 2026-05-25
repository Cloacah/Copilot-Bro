/**
 * One representative text model per built-in provider for host UI smoke LM probes.
 * Primary runtime ids are resolved from {@link HOST_UI_SMOKE_PROVIDER_TEXT_PROFILE}.
 */
import {
	HOST_UI_SMOKE_PROVIDER_TEXT_PROFILE,
	resolveHostUiModelProfilePrimary,
	type HostUiModelProfileId
} from "../chat/hostUiModelProfiles";

const PROBE_PROFILE_SPECS: readonly {
	readonly provider: string;
	readonly profile: HostUiModelProfileId;
	readonly modelFamilyKey?: string;
}[] = [
	{ provider: "deepseek", profile: "deepseek.text" },
	{ provider: "zhipu", profile: "zhipu.text" },
	{ provider: "minimax", profile: "minimax.text" },
	{ provider: "kimi", profile: "kimi.text", modelFamilyKey: "moonshot-v1" },
	{ provider: "qwen", profile: "qwen.text-probe", modelFamilyKey: "qwen-turbo" }
];

function runtimeIdToProbeId(runtimeId: string, modelFamilyKey?: string): { id: string; modelFamilyKey?: string } {
	const [modelPart] = runtimeId.split("::");
	if (modelFamilyKey) {
		return { id: modelFamilyKey, modelFamilyKey };
	}
	return { id: modelPart };
}

export const HOST_UI_SMOKE_PROVIDER_PROBE_TARGETS: readonly {
	readonly provider: string;
	readonly id: string;
	readonly modelFamilyKey?: string;
}[] = PROBE_PROFILE_SPECS.map((spec) => {
	const runtimeId = resolveHostUiModelProfilePrimary(
		HOST_UI_SMOKE_PROVIDER_TEXT_PROFILE[spec.provider] ?? spec.profile
	);
	const { id, modelFamilyKey } = runtimeIdToProbeId(runtimeId, spec.modelFamilyKey);
	return {
		provider: spec.provider,
		id,
		modelFamilyKey
	};
});

export function resolveHostUiSmokeProviderProbeRuntimeId(target: {
	provider: string;
	id: string;
	modelFamilyKey?: string;
}): string {
	const familyKey = target.modelFamilyKey?.trim();
	if (familyKey) {
		return `${familyKey}::${target.provider.trim().toLowerCase()}`;
	}
	return `${target.id}::${target.provider.trim().toLowerCase()}`;
}
