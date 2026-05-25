import { readFile } from "node:fs/promises";
import { runHostUiSmokeP6PathHydrationProbe, type HostUiSmokeP6PathHydrationProbeResult } from "./p6PathHydrationProbe";
import {
	runHostUiSmokeP7RestoreArtifactProbe,
	type HostUiSmokeP7RestoreArtifactProbeResult
} from "./p7RestoreProbe";
import { assertHostUiSmokeTestButtonExists } from "../fixtures/vision";

export type { HostUiSmokeP6PathHydrationProbeResult } from "./p6PathHydrationProbe";
export type { HostUiSmokeP7RestoreArtifactProbeResult } from "./p7RestoreProbe";
export { runHostUiSmokeP7RestoreArtifactProbe } from "./p7RestoreProbe";

export async function runHostUiSmokeP6P7RealAssetsProbe(
	logger: { info: (message: string, data?: unknown) => void; warn?: (message: string, data?: unknown) => void }
): Promise<{ p6: HostUiSmokeP6PathHydrationProbeResult; p7: HostUiSmokeP7RestoreArtifactProbeResult }> {
	logger.info("host-ui-smoke.p6-p7.real-assets.probe.start", {});
	const p6 = await runHostUiSmokeP6PathHydrationProbe(logger);
	const p7 = await runHostUiSmokeP7RestoreArtifactProbe(logger);
	logger.info("host-ui-smoke.p6-p7.real-assets.probe.end", {
		ok: p6.ok && p7.ok,
		p6Ok: p6.ok,
		p7Ok: p7.ok,
		hydratedCount: p6.hydratedCount,
		artifactSha256: p7.artifactSha256
	});
	return { p6, p7 };
}

export async function readHostUiSmokeTestButtonBytes(
	fileName?: string
): Promise<Uint8Array> {
	const assetPath = await assertHostUiSmokeTestButtonExists(process.env, fileName);
	return new Uint8Array(await readFile(assetPath));
}
