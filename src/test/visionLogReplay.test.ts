import test from "node:test";
import assert from "node:assert/strict";
import {
	parseVisionLogReplay,
	validateVisionCacheHitEvidenceContract,
	validateVisionCacheMissEvidenceContract
} from "../visionProtocol/visionLogReplay";

test("vision log replay: cache hit rejects request.start after cache.hit (P7 replay)", () => {
	const log = [
		'vision.input.bound {"evidenceId":"ev-replay"}',
		'vision.proxy.cache.hit {"evidenceId":"ev-replay"}',
		'[INFO] request.start {"model":"deepseek"}'
	].join("\n");
	const missing = validateVisionCacheHitEvidenceContract(parseVisionLogReplay(log));
	assert.ok(missing.some((item) => item.includes("no-request-start-after-cache-hit")));
});

test("vision log replay: cache hit reuses evidence without raw image on main request", () => {
	const log = [
		'[INFO] vision.input.bound {"sourceKind":"screenshot","imageHashPrefix":"a1b2","evidenceId":"ev-1","route":"proxy"}',
		'[INFO] vision.proxy.cache.hit {"evidenceId":"ev-1","reused":true}',
		'[INFO] request.messages.summary {"hasImageParts":false,"imagePartCount":0}'
	].join("\n");
	const facts = parseVisionLogReplay(log);
	assert.deepEqual(facts.boundEvidenceIds, ["ev-1"]);
	assert.deepEqual(facts.cacheHitEvidenceIds, ["ev-1"]);
	assert.equal(facts.requestHasImageParts, false);
	assert.deepEqual(validateVisionCacheHitEvidenceContract(facts), []);
});

test("vision log replay: cache miss requires bound input and miss line", () => {
	const log = [
		'vision.input.bound {"evidenceId":"ev-2"}',
		'vision.proxy.cache.miss {"evidenceId":"ev-2"}'
	].join("\n");
	const facts = parseVisionLogReplay(log);
	assert.deepEqual(validateVisionCacheMissEvidenceContract(facts), []);
	assert.ok(validateVisionCacheHitEvidenceContract(facts).length > 0);
});

test("vision log replay: cache hit with hasImageParts true fails contract", () => {
	const log = [
		'vision.input.bound {"evidenceId":"ev-3"}',
		'vision.proxy.cache.hit {"evidenceId":"ev-3"}',
		'request.messages.summary {"hasImageParts":true}'
	].join("\n");
	const missing = validateVisionCacheHitEvidenceContract(parseVisionLogReplay(log));
	assert.ok(missing.some((item) => item.includes("hasImageParts")));
});

test("vision log replay: collects route strategies and screenshot_page marker", () => {
	const log = [
		'copilot debug tools_0.json screenshot_page [image/jpeg: 12 bytes]',
		'[INFO] vision.input.bound {"evidenceId":"ev-r","sourceKind":"screenshot"}',
		'[INFO] vision.route.selected {"model":"m1","strategy":"proxy","reason":"test"}',
		'[INFO] vision.route.selected {"model":"m1","strategy":"native"}',
		'[INFO] vision.proxy.cache.miss {"evidenceId":"ev-r"}'
	].join("\n");
	const facts = parseVisionLogReplay(log);
	assert.equal(facts.hasScreenshotPageReference, true);
	assert.deepEqual(facts.routeStrategies, ["proxy", "native"]);
	assert.deepEqual(facts.boundEvidenceIds, ["ev-r"]);
	assert.deepEqual(validateVisionCacheMissEvidenceContract(facts), []);
});
