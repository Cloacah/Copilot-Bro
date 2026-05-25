import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

let content = execSync("git show HEAD:src/visionProxy.ts", { encoding: "utf8" });
const transcript = readFileSync(
	"C:/Users/onemt/.cursor/projects/d-Workspace-Extended-Models-For-Copilot/agent-transcripts/5a403f32-b061-4459-9e22-f100b930e8e9/5a403f32-b061-4459-9e22-f100b930e8e9.jsonl",
	"utf8"
);
let applied = 0;
let failed = 0;
for (const line of transcript.split(/\n/)) {
	let event;
	try {
		event = JSON.parse(line);
	} catch {
		continue;
	}
	if (event.role !== "assistant") {
		continue;
	}
	for (const block of event.message?.content ?? []) {
		if (block.type !== "tool_use" || block.name !== "StrReplace") {
			continue;
		}
		const filePath = String(block.input?.path ?? "");
		if (!filePath.replace(/\\/g, "/").endsWith("visionProxy.ts")) {
			continue;
		}
		const { old_string: oldString, new_string: newString } = block.input ?? {};
		if (!oldString || !content.includes(oldString)) {
			failed += 1;
			continue;
		}
		content = content.replace(oldString, newString);
		applied += 1;
	}
}
writeFileSync("src/visionProxy.ts", content);
console.log({ applied, failed, lines: content.split(/\n/).length });
