import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	HOST_UI_SMOKE_PALETTE,
	listHostUiSmokePaletteContracts
} from "../e2e/driver/hostUiSmokePaletteContract";

test("listHostUiSmokePaletteContracts matches HOST_UI_SMOKE_PALETTE values", () => {
	const listed = new Set(listHostUiSmokePaletteContracts().map((e) => `${e.commandId}\t${e.title}`));
	const fromRecord = new Set(
		Object.values(HOST_UI_SMOKE_PALETTE).map((e) => `${e.commandId}\t${e.title}`)
	);
	assert.deepEqual(listed, fromRecord);
});

test("host UI smoke palette titles match package.json contributes.commands", () => {
	const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
		contributes: { commands: { command: string; title: string; category?: string }[] };
	};
	const byCommand = new Map(pkg.contributes.commands.map((c) => [c.command, c]));
	for (const entry of listHostUiSmokePaletteContracts()) {
		const row = byCommand.get(entry.commandId);
		assert.ok(row, `missing package.json command: ${entry.commandId}`);
		assert.equal(row.title, entry.title, `title drift for ${entry.commandId}`);
		assert.equal(row.category, "Copilot Bro", `category drift for ${entry.commandId}`);
	}
});

test("host UI smoke palette command ids are unique", () => {
	const ids = listHostUiSmokePaletteContracts().map((e) => e.commandId);
	assert.equal(new Set(ids).size, ids.length);
});
