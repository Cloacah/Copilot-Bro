/**
 * In-process ring buffer of log message keys for Host UI smoke (wired from Logger when COPILOT_BRO_UI_SMOKE=1).
 */
const MAX_LINES = 800;
const buffer: string[] = [];

export function formatSmokeLogEvidenceLine(
	message: string,
	data: unknown | undefined,
	redact: (value: unknown) => unknown
): string {
	return data === undefined ? message : `${message} ${JSON.stringify(redact(data))}`;
}

export function clearSmokeLogEvidence(): void {
	buffer.length = 0;
}

export function recordHostUiSmokeLogLine(message: string): void {
	if (!message.trim()) {
		return;
	}
	buffer.push(message);
	if (buffer.length > MAX_LINES) {
		buffer.splice(0, buffer.length - MAX_LINES);
	}
}

export function drainHostUiSmokeLogEvidence(): string[] {
	const copy = [...buffer];
	buffer.length = 0;
	return copy;
}

export function snapshotHostUiSmokeLogEvidence(): readonly string[] {
	return [...buffer];
}

export function joinLogEvidence(lines: readonly string[]): string {
	return lines.join("\n");
}

export function findMissingLogMarkers(
	lines: readonly string[],
	required: readonly string[],
	forbidden: readonly string[] = [],
	requiredAnyOf: readonly (readonly string[])[] = []
): { missing: string[]; forbiddenHit: string[] } {
	const joined = joinLogEvidence(lines);
	const missing: string[] = [];
	for (const marker of required) {
		if (!joined.includes(marker)) {
			missing.push(marker);
		}
	}
	if (requiredAnyOf.length > 0) {
		const anyGroupSatisfied = requiredAnyOf.some((group) => group.every((marker) => joined.includes(marker)));
		if (!anyGroupSatisfied) {
			missing.push(
				`anyOf(${requiredAnyOf.map((group) => group.join(" + ")).join(" | ")})`
			);
		}
	}
	const forbiddenHit: string[] = [];
	for (const marker of forbidden) {
		if (joined.includes(marker)) {
			forbiddenHit.push(marker);
		}
	}
	return { missing, forbiddenHit };
}
