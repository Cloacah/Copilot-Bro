/**
 * Scrape Bailian model market grouping from the live console page (Playwright).
 * Requires interactive login on first run; saves storage to artifacts/bailian-auth.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const targetUrl =
	"https://bailian.console.aliyun.com/cn-beijing/?tab=model#/model-market/all?providers=qwen%2Cwan&capabilities=TG%2CReasoning%2CVU";
const authPath = path.join(rootDir, "artifacts/bailian-auth.json");
const outPath = path.join(rootDir, "artifacts/bailian-model-market-scrape.json");

async function main() {
	const headless = process.env.BAILIAN_SCRAPE_HEADLESS !== "0";
	const browser = await chromium.launch({ headless });
	const contextOptions = fs.existsSync(authPath) ? { storageState: authPath } : {};
	const context = await browser.newContext(contextOptions);
	const page = await context.newPage();
	/** @type {Array<{ url: string, body: unknown }>} */
	const capturedApis = [];
	page.on("response", async (response) => {
		const url = response.url();
		if (
			!/dashscope|bailian|model/i.test(url) ||
			!/json/i.test(response.headers()["content-type"] ?? "")
		) {
			return;
		}
		try {
			const body = await response.json();
			if (body && typeof body === "object") {
				capturedApis.push({ url, body });
			}
		} catch {
			// ignore non-json
		}
	});

	await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 120_000 });

	if (await page.locator("text=请登录").count() || (await page.title()).includes("登录")) {
		if (headless) {
			throw new Error("Bailian console requires login. Run: BAILIAN_SCRAPE_HEADLESS=0 node scripts/scrape-bailian-model-market.mjs");
		}
		console.log("Please log in to Bailian in the opened browser window...");
		await page.waitForURL(/model-market/, { timeout: 300_000 });
		await context.storageState({ path: authPath });
	}

	await page.waitForTimeout(5000);

	// Scroll to load lazy cards
	for (let i = 0; i < 8; i += 1) {
		await page.evaluate(() => window.scrollBy(0, window.innerHeight));
		await page.waitForTimeout(800);
	}

	const scraped = await page.evaluate(() => {
		const cards = [];
		const seen = new Set();

		function pushCard(entry) {
			const key = `${entry.category}::${entry.displayName}`;
			if (!entry.displayName || seen.has(key)) {
				return;
			}
			seen.add(key);
			cards.push(entry);
		}

		// Bailian model market: section headers + model cards
		const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [class*='category'], [class*='group-title']"));
		let currentCategory = "";
		for (const heading of headings) {
			const text = heading.textContent?.trim() ?? "";
			if (text.length > 0 && text.length < 40) {
				currentCategory = text;
			}
		}

		// Try common card patterns
		const cardNodes = document.querySelectorAll(
			"[class*='model-card'], [class*='ModelCard'], [data-testid*='model'], .next-card, .ant-card"
		);
		for (const node of cardNodes) {
			const title =
				node.querySelector("[class*='title'], [class*='name'], h3, h4, strong")?.textContent?.trim() ??
				node.textContent?.trim().split("\n")[0]?.trim() ??
				"";
			if (!title || title.length > 80) {
				continue;
			}
			const versionNodes = node.querySelectorAll("[class*='version'], [class*='snapshot'], li, option");
			const versionIds = Array.from(versionNodes)
				.map((el) => el.textContent?.trim() ?? "")
				.filter((t) => /^[a-z][a-z0-9._-]+$/.test(t));
			const category =
				node.closest("[class*='section'], [class*='group'], [class*='category']")?.querySelector("h2, h3, h4")
					?.textContent?.trim() ?? currentCategory;
			pushCard({ category, displayName: title, versionIds });
		}

		// Fallback: dump structured text blocks for debugging
		const bodyText = document.body.innerText;
		const versionBlocks = [];
		const lines = bodyText.split("\n").map((line) => line.trim()).filter(Boolean);
		for (let index = 0; index < lines.length; index += 1) {
			if (lines[index] !== "最新版本") {
				continue;
			}
			const modelId = lines[index + 1] ?? "";
			const displayName = lines[index - 1] ?? "";
			const series = lines[index + 6] ?? "";
			if (/^qwen|^qvq|^qwq|^tongyi/i.test(modelId)) {
				versionBlocks.push({ displayName, modelId, series });
			}
		}
		return {
			cards,
			versionBlocks,
			bodyTextSample: bodyText.slice(0, 20000),
			url: location.href,
			title: document.title
		};
	});

	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(
		outPath,
		`${JSON.stringify({ ...scraped, capturedApis: capturedApis.slice(0, 40) }, null, 2)}\n`,
		"utf8"
	);
	console.log(`Wrote scrape to ${outPath} (${scraped.cards?.length ?? 0} cards)`);

	await browser.close();
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
