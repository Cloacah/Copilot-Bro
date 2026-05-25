/**
 * Host UI smoke log evidence (re-exports automation buffer; clears benchmark capture on reset).
 */
import { resetHostUiSmokeBenchmarkPageSsimCapture } from "./benchmark/pageSsim";
export {
	clearSmokeLogEvidence,
	drainHostUiSmokeLogEvidence,
	findMissingLogMarkers,
	formatSmokeLogEvidenceLine,
	joinLogEvidence,
	recordHostUiSmokeLogLine,
	snapshotHostUiSmokeLogEvidence
} from "../../smokeLogBridge/smokeLogEvidence";

import { clearSmokeLogEvidence } from "../../smokeLogBridge/smokeLogEvidence";

export function clearHostUiSmokeLogEvidence(): void {
	clearSmokeLogEvidence();
	resetHostUiSmokeBenchmarkPageSsimCapture();
}
