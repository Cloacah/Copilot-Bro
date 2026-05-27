# Model catalog generators

## Zhipu (智谱 / BigModel)

**Offline (CI-safe):**

```bash
npm run catalog:zhipu
```

**Refresh cards from BigModel guide pages (text / vlm / free):**

```bash
npm run catalog:zhipu:scrape
npm run catalog:zhipu
npm run catalog:verify
```

`catalog:zhipu:scrape` fetches [llms.txt](https://docs.bigmodel.cn/llms.txt) plus [model-overview](https://docs.bigmodel.cn/cn/guide/start/model-overview) links, opens each guide page, and extracts API `model=` samples and hub `<Tab title="GLM-...">` variants (e.g. GLM-4.1V-Thinking → FlashX/Flash only). Writes `resources/zhipu-model-cards.json`.

Reads `resources/zhipu-model-cards.json` and writes:

- `resources/zhipu-bigmodel-model-catalog.json`
- `src/config/zhipuModelFamilies.ts`

**Live merge (recommended when refreshing):**

```bash
ZHIPU_API_KEY=your-key npm run catalog:zhipu
```

Also calls `GET https://open.bigmodel.cn/api/paas/v4/models` and merges any returned ids into families via `scripts/catalog/build-zhipu-model-families.mjs` assignment rules. Unmapped API ids are printed as warnings.

The public models API is **text-oriented** and may omit vision-only ids; vision families therefore stay anchored on `zhipu-model-cards.json`. For a fully current list:

1. Run `npm run catalog:zhipu:scrape` (or hand-edit `resources/zhipu-model-cards.json`).
2. Run `ZHIPU_API_KEY=... npm run catalog:zhipu` to merge live ids.
3. Run `npm run catalog:verify` before commit.

## Qwen (DashScope / Bailian)

```bash
npm run catalog:qwen
```

Uses `resources/qwen-bailian-model-catalog.json`. Optional live scrape: `node scripts/catalog/scrape-bailian-model-market.mjs` (Playwright + login).

## Kimi (Moonshot)

```bash
npm run catalog:kimi
```

Reads `resources/kimi-model-cards.json` (curated from [platform models](https://platform.moonshot.ai/docs/models)) and writes:

- `resources/kimi-moonshot-model-catalog.json`
- `src/config/kimiModelFamilies.ts`

## Verify committed artifacts

```bash
npm run catalog:verify
```

## Dev / scrape helpers

```bash
npm run catalog:bailian:scrape
npm run dev:recover-vision-proxy
npm run dev:rebuild-vision-proxy-from-vsix
npm run dev:recover-vision-proxy-from-transcript
```
