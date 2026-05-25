/**
 * Host UI E2E suite ids (driven by COPILOT_BRO_UI_SMOKE_E2E — comma-separated, or "all").
 * Used by automation and unit tests; keep ids stable for CI filters.
 *
 * `all` expands to every suite in {@link HOST_UI_SMOKE_E2E_DEFAULT_SUITE_IDS}.
 * Image post-processing suites still run under `all`; paused pipeline steps log `"skipped":true`.
 */
export const HOST_UI_SMOKE_E2E_CORE_SUITE_IDS = [
	"github-chat-login",
	"config-panel",
	"chat-scenarios",
	"provider-probe",
	"preset-catalog",
	"vision-contract",
	"vision-json-repair",
	"post-chat-lm"
] as const;

/** Formerly opt-in; now included in default `all`. */
export const HOST_UI_SMOKE_E2E_EXTENDED_SUITE_IDS = [
	"vision-probe",
	"screenshot-page-vision-route",
	"vision-chat-progress",
	"phase1-settings-exhaustive",
	"agent-smoke-budgeted",
	"p6-p7-real-assets"
] as const;

/** @deprecated Use {@link HOST_UI_SMOKE_E2E_EXTENDED_SUITE_IDS}. */
export const HOST_UI_SMOKE_E2E_OPTIONAL_SUITE_IDS = HOST_UI_SMOKE_E2E_EXTENDED_SUITE_IDS;

export const HOST_UI_SMOKE_E2E_DEFAULT_SUITE_IDS = [
	...HOST_UI_SMOKE_E2E_CORE_SUITE_IDS,
	...HOST_UI_SMOKE_E2E_EXTENDED_SUITE_IDS
] as const;

export const HOST_UI_SMOKE_E2E_SUITE_IDS = HOST_UI_SMOKE_E2E_DEFAULT_SUITE_IDS;

export type HostUiSmokeE2eSuiteId = (typeof HOST_UI_SMOKE_E2E_SUITE_IDS)[number];

const ALL_DEFAULT = new Set<HostUiSmokeE2eSuiteId>([...HOST_UI_SMOKE_E2E_DEFAULT_SUITE_IDS]);
const VALID_IDS = new Set<HostUiSmokeE2eSuiteId>([...HOST_UI_SMOKE_E2E_SUITE_IDS]);

function isKnownSuiteId(value: string): value is HostUiSmokeE2eSuiteId {
	return VALID_IDS.has(value as HostUiSmokeE2eSuiteId);
}

export function parseHostUiSmokeE2eSuites(env: Pick<NodeJS.ProcessEnv, string>): ReadonlySet<HostUiSmokeE2eSuiteId> {
	const raw = env.COPILOT_BRO_UI_SMOKE_E2E?.trim().toLowerCase();
	if (!raw || raw === "all") {
		return new Set(ALL_DEFAULT);
	}
	const parts = raw.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
	const out = new Set<HostUiSmokeE2eSuiteId>();
	for (const p of parts) {
		if (p === "all") {
			for (const id of ALL_DEFAULT) {
				out.add(id);
			}
			continue;
		}
		if (isKnownSuiteId(p)) {
			out.add(p);
		} else {
			throw new Error(
				`Unknown COPILOT_BRO_UI_SMOKE_E2E suite "${p}". Default (all): ${HOST_UI_SMOKE_E2E_DEFAULT_SUITE_IDS.join(", ")}`
			);
		}
	}
	if (out.size === 0) {
		throw new Error("COPILOT_BRO_UI_SMOKE_E2E resolved to an empty suite list.");
	}
	return applyHostUiSmokeE2eSuiteDependencies(out);
}

/**
 * Implicit suite dependencies (e.g. chat-scenarios requires Copilot Chat sign-in preflight).
 */
export function applyHostUiSmokeE2eSuiteDependencies(
	suites: ReadonlySet<HostUiSmokeE2eSuiteId>
): ReadonlySet<HostUiSmokeE2eSuiteId> {
	if (suites.has("chat-scenarios") && !suites.has("github-chat-login")) {
		const withLogin = new Set(suites);
		withLogin.add("github-chat-login");
		return withLogin;
	}
	return suites;
}

export function shouldRunHostUiSmokeE2eSuite(suites: ReadonlySet<HostUiSmokeE2eSuiteId>, id: HostUiSmokeE2eSuiteId): boolean {
	return suites.has(id);
}

/** True when the run intentionally trims to config-panel UI validation only. */
export function isConfigPanelOnlyHostUiSmokeRun(suites: ReadonlySet<HostUiSmokeE2eSuiteId>): boolean {
	return suites.size === 1 && suites.has("config-panel");
}
