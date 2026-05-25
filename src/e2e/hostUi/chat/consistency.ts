import type { HostUiSmokeChatIntegrationScenario } from "./integration";

export interface ChatConsistencyCheck {
	readonly id: string;
	readonly ok: boolean;
	readonly detail: string;
}

export interface ChatConsistencyReport {
	readonly ok: boolean;
	readonly checks: readonly ChatConsistencyCheck[];
}

/**
 * Post-suite multi-turn / ordering consistency (log text from extension output channel).
 */
export function validateHostUiSmokeChatIntegrationConsistency(
	logText: string,
	scenarioIds: readonly string[]
): ChatConsistencyReport {
	const checks: ChatConsistencyCheck[] = [];
	const ranIds = [...scenarioIds];
	const endLines = logText.split(/\r?\n/u).filter((line) => line.includes("host-ui-smoke.chat.integration.scenario.end"));

	for (const scenarioId of ranIds) {
		const line = endLines.find((entry) => entry.includes(`"scenarioId":"${scenarioId}"`) || entry.includes(`"scenarioId": "${scenarioId}"`));
		checks.push({
			id: `scenario-end:${scenarioId}`,
			ok: Boolean(line),
			detail: line ? "scenario.end present" : "missing scenario.end"
		});
		if (line?.includes('"ok":false') && !line.includes('"skipped":true')) {
			checks.push({
				id: `scenario-not-failed:${scenarioId}`,
				ok: false,
				detail: "scenario ended ok:false without skip"
			});
		}
	}

	if (ranIds.includes("vision-proxy-cache-hit") && ranIds.includes("vision-proxy-miss")) {
		const missIdx = logText.indexOf('"scenarioId":"vision-proxy-miss"');
		const hitIdx = logText.indexOf('"scenarioId":"vision-proxy-cache-hit"');
		const missBeforeHit = (missIdx >= 0 && hitIdx >= 0 && missIdx < hitIdx)
			|| logText.includes("vision.proxy.cache.hit");
		checks.push({
			id: "ordering:miss-before-hit",
			ok: missBeforeHit || logText.includes("vision.proxy.cache.hit"),
			detail: "cache-hit scenario should follow miss in suite or emit cache.hit"
		});
	}

	if (ranIds.includes("multi-turn-vision-then-token")) {
		const turnOkCount = logText.split(/\r?\n/u).filter((line) =>
			line.includes("host-ui-smoke.chat.output")
			&& line.includes("integration-turn")
			&& line.includes('"ok":true')
		).length;
		const endLine = endLines.find((entry) => entry.includes("multi-turn-vision-then-token"));
		const turnCountOk = Boolean(
			endLine?.includes('"turnCount":2')
			|| endLine?.includes('"turnCount": 2')
			|| turnOkCount >= 2
		);
		checks.push({
			id: "multi-turn:vision-then-token",
			ok: turnCountOk,
			detail: `integration turns ok=${turnOkCount} (expected 2)`
		});
	}

	if (ranIds.includes("prompt-preset-applied")) {
		const hasPresetApplied = logText.includes("prompt.preset.applied")
			&& logText.includes("built-in:senior-engineer");
		checks.push({
			id: "prompt-preset:applied",
			ok: hasPresetApplied,
			detail: "prompt.preset.applied with built-in:senior-engineer"
		});
	}

	const structuredVisionScenarioIds = [
		"p3-global-qwen-proxy-chat",
		"p7-restore-artifact-chat",
		"p7-describe-only-evidence",
		"p6-path-hydration-chat"
	] as const;
	for (const scenarioId of structuredVisionScenarioIds) {
		if (!ranIds.includes(scenarioId)) {
			continue;
		}
		const hasStructuredLog = logText.includes("vision.proxy.structured")
			&& /"elementCount":\s*[1-9]/u.test(logText);
		const hasSnapshotInOutput = logText.includes("normalizedProxySnapshot:")
			&& logText.includes(`"scenarioId":"${scenarioId}"`);
		const hasElementParams = /element\.\S+\.(imageParams|svgParams|bbox)=/u.test(logText)
			|| /"bbox":\s*\{/u.test(logText);
		checks.push({
			id: `structured-params:${scenarioId}`,
			ok: hasStructuredLog || hasSnapshotInOutput || hasElementParams,
			detail: "vision.proxy.structured / normalizedProxySnapshot / element params must survive pipeline suspend"
		});
	}

	if (ranIds.includes("multi-provider-switch-context")) {
		const switchLine = endLines.find((entry) => entry.includes("multi-provider-switch-context"));
		checks.push({
			id: "multi-provider:turn-count",
			ok: Boolean(switchLine?.includes('"turnCount":3') || switchLine?.includes('"turnCount": 3')),
			detail: "multi-provider-switch-context expects 3 turns"
		});
		const modelSwitches = (logText.match(/request\.start/gu) ?? []).length;
		checks.push({
			id: "multi-provider:request-starts",
			ok: modelSwitches >= 3,
			detail: `request.start count=${modelSwitches} (expected ≥3)`
		});
	}

	// integration.suite.summary is logged after this validation; do not require it in logText here.

	const ok = checks.every((check) => check.ok);
	return { ok, checks };
}
