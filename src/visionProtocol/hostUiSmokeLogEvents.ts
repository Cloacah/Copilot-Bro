/**
 * Host UI smoke / automation log event names (substring markers for tail watch + integration).
 */
export const HostUiSmokeLogEvent = {
	githubAuthPreflightEnd: "host-ui-smoke.github-auth.preflight.end",
	visionProgressFlush: "host-ui-smoke.vision.progress.flush",
	chatOutput: "host-ui-smoke.chat.output",
	chatParticipantEnd: "host-ui-smoke.chat.participant.end",
	chatParticipantFinished: "host-ui-smoke.chat.participant.finished",
	chatIntegrationScenarioStart: "host-ui-smoke.chat.integration.scenario.start",
	chatIntegrationScenarioEnd: "host-ui-smoke.chat.integration.scenario.end",
	chatIntegrationSuiteSummary: "host-ui-smoke.chat.integration.suite.summary",
	chatConsistencyEnd: "host-ui-smoke.chat.consistency.end",
	p4SelfReferPolicy: "host-ui-smoke.p4.self-refer.policy",
	chatSuiteAutoRunStart: "host-ui-smoke.chat-suite.auto-run.start",
	chatSuiteAutoRunEnd: "host-ui-smoke.chat-suite.auto-run.end"
} as const;
