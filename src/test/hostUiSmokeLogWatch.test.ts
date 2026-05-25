import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	detectWrongChatParticipantRouting,
	getLogByteOffset,
	hostUiSmokeLogTailHasEvent,
	isChatParticipantWorkInProgress,
	logTailIncludesChatOpenAck,
	readLogFromOffset,
	scanChatLogTail,
	waitForChatParticipantOutcome,
	waitForChatSubmitOutcome
} from "../e2e/driver/hostUiSmokeLogWatch";

test("hostUiSmokeLogTailHasEvent matches emitted log lines not JSON marker strings", () => {
	const waiting = '[t] [INFO] host-ui-smoke.chat-suite.auto-run.waiting {"marker":"host-ui-smoke.github-auth.preflight.end"}';
	const done = "[t] [INFO] host-ui-smoke.github-auth.preflight.end {\"outcome\":\"already-signed-in\"}";
	assert.equal(hostUiSmokeLogTailHasEvent(waiting, "host-ui-smoke.github-auth.preflight.end"), false);
	assert.equal(hostUiSmokeLogTailHasEvent(done, "host-ui-smoke.github-auth.preflight.end"), true);
	assert.equal(logTailIncludesChatOpenAck("[t] [INFO] host-ui-smoke.chat.open.end {}\n"), true);
});

test("detectWrongChatParticipantRouting flags Copilot default-agent replies", () => {
	const preview = "Since this message was sent to me (GitHub Copilot), I can't execute those extension-specific commands directly.";
	assert.ok(detectWrongChatParticipantRouting(preview));
	const scan = scanChatLogTail(`[t] [INFO] host-ui-smoke.chat.output {"preview":${JSON.stringify(preview)}}\n`);
	assert.equal(scan.failure?.kind, "wrong-participant");
});

test("scanChatLogTail fails on integration scenario.end ok:false without skip", () => {
	const tail = [
		'[t] [INFO] host-ui-smoke.chat.participant.request {"prompt":"x"}',
		'[t] [INFO] host-ui-smoke.chat.integration.scenario.end {"scenarioId":"vision-proxy-miss","ok":false,"message":"missing marker"}'
	].join("\n");
	const scan = scanChatLogTail(tail);
	assert.equal(scan.failure?.kind, "integration-failed");
});

test("scanChatLogTail fails fast on participant.failed with message", () => {
	const tail = [
		'[t] [INFO] host-ui-smoke.chat.participant.request {"prompt":"x"}',
		'[t] [WARN] host-ui-smoke.chat.participant.failed {"message":"API key invalid"}'
	].join("\n");
	const scan = scanChatLogTail(tail);
	assert.equal(scan.failure?.kind, "participant-failed");
	assert.match(scan.failure?.message ?? "", /API key invalid/);
});

test("scanChatLogTail treats participant.finished as terminal success", () => {
	const tail = [
		'[t] [INFO] host-ui-smoke.chat.participant.request {"prompt":"x"}',
		'[t] [INFO] host-ui-smoke.chat.consistency.end {"ok":true}',
		'[t] [INFO] host-ui-smoke.chat.integration.suite.summary {"ok":true}',
		'[t] [INFO] host-ui-smoke.chat.participant.finished {"ok":true,"responseText":"done"}'
	].join("\n");
	const scan = scanChatLogTail(tail);
	assert.equal(scan.participantFinished?.status, "completed");
});

test("isChatParticipantWorkInProgress stays true until consistency.end", () => {
	const tail = [
		'[t] [INFO] host-ui-smoke.chat.participant.request {}',
		'[t] [INFO] host-ui-smoke.chat.integration.scenario.start {"scenarioId":"a"}',
		'[t] [INFO] host-ui-smoke.chat.participant.finished {"ok":true}'
	].join("\n");
	assert.equal(isChatParticipantWorkInProgress(tail, { requireIntegrationSuite: true }), true);
});

test("readLogFromOffset only returns bytes appended after offset", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "smoke-log-"));
	const logPath = path.join(dir, "host-ui-smoke.log");
	await writeFile(logPath, "line-a\n", "utf8");
	const offset = await getLogByteOffset(logPath);
	await writeFile(logPath, "line-a\nline-b\n", "utf8");
	const tail = await readLogFromOffset(logPath, offset);
	assert.equal(tail.trim(), "line-b");
});

test("waitForChatParticipantOutcome invokes onPoll during wait", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "smoke-log-poll-"));
	const logPath = path.join(dir, "host-ui-smoke.log");
	await writeFile(logPath, "", "utf8");
	const offset = await getLogByteOffset(logPath);
	let pollCount = 0;
	const waitPromise = waitForChatParticipantOutcome(logPath, offset, 4_000, undefined, {
		postFinishedGraceMs: 50,
		onPoll: async () => {
			pollCount += 1;
		}
	});
	await delay(300);
	assert.ok(pollCount >= 1, `expected onPoll during wait, pollCount=${pollCount}`);
	await writeFile(
		logPath,
		[
			'[t] [INFO] host-ui-smoke.chat.participant.request {}',
			'[t] [INFO] host-ui-smoke.chat.participant.finished {"ok":true,"responseText":"ok"}'
		].join("\n") + "\n",
		"utf8"
	);
	const outcome = await waitPromise;
	assert.equal(outcome.status, "completed");
});

test("waitForChatSubmitOutcome ignores stale submit.end before byte offset", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "smoke-log-submit-"));
	const logPath = path.join(dir, "host-ui-smoke.log");
	await writeFile(logPath, "[old] host-ui-smoke.chat.submit.end {}\n", "utf8");
	const offset = await getLogByteOffset(logPath);
	const waitPromise = waitForChatSubmitOutcome(logPath, offset, 2_000);
	await delay(400);
	await writeFile(logPath, "[old] host-ui-smoke.chat.submit.end {}\n[new] host-ui-smoke.chat.submit.end {}\n", "utf8");
	const outcome = await waitPromise;
	assert.equal(outcome.status, "submitted");
});

test("waitForChatParticipantOutcome surfaces integration scenario failure", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "smoke-log-participant-"));
	const logPath = path.join(dir, "host-ui-smoke.log");
	await writeFile(logPath, "", "utf8");
	const offset = await getLogByteOffset(logPath);
	const waitPromise = waitForChatParticipantOutcome(logPath, offset, 3_000);
	await delay(300);
	await appendFile(
		logPath,
		'[t] [INFO] host-ui-smoke.chat.integration.scenario.end {"scenarioId":"p3","ok":false,"message":"boom"}\n',
		"utf8"
	);
	const outcome = await waitPromise;
	assert.equal(outcome.status, "failed");
	assert.match(outcome.status === "failed" ? outcome.failure.message : "", /p3/);
});

test("waitForChatParticipantOutcome waits for participant.finished not premature end", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "smoke-log-finished-"));
	const logPath = path.join(dir, "host-ui-smoke.log");
	await writeFile(logPath, "", "utf8");
	const offset = await getLogByteOffset(logPath);
	const waitPromise = waitForChatParticipantOutcome(logPath, offset, 5_000, undefined, {
		requireIntegrationSuite: true,
		postFinishedGraceMs: 200
	});
	await delay(200);
	await appendFile(
		logPath,
		'[t] [INFO] host-ui-smoke.chat.participant.request {}\n[t] [INFO] host-ui-smoke.chat.integration.scenario.start {"scenarioId":"a"}\n',
		"utf8"
	);
	await delay(400);
	await appendFile(
		logPath,
		'[t] [INFO] host-ui-smoke.chat.integration.scenario.end {"scenarioId":"a","ok":true}\n[t] [INFO] host-ui-smoke.chat.consistency.end {"ok":true}\n[t] [INFO] host-ui-smoke.chat.integration.suite.summary {"ok":true}\n[t] [INFO] host-ui-smoke.chat.participant.finished {"ok":true,"responseText":"ok"}\n',
		"utf8"
	);
	const outcome = await waitPromise;
	assert.equal(outcome.status, "completed");
});

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function appendFile(file: string, data: string, encoding: BufferEncoding): Promise<void> {
	const { appendFile: append } = await import("node:fs/promises");
	return append(file, data, encoding);
}
