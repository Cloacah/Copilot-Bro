# Model Preset Sources

This file records where Copilot Bro model presets should be checked during future updates.

## Provider Documentation

- DeepSeek: https://api-docs.deepseek.com/zh-cn/
- Zhipu / Z.AI: https://docs.bigmodel.cn/cn/api/introduction
- MiniMax: https://platform.minimax.io/docs/api-reference/text-openai-api
- Kimi / Moonshot: https://platform.kimi.ai/docs/models
- Qwen / DashScope (OpenAI compatible): https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
- Bailian model market (Qwen + TG / Reasoning / VU filter): https://bailian.console.aliyun.com/cn-beijing/?tab=model#/model-market/all?providers=qwen%2Cwan&capabilities=TG%2CReasoning%2CVU
- Regenerate Qwen family catalog from Bailian filters: `npm run catalog:qwen` (optional `DASHSCOPE_API_KEY` for live DashScope `GET /api/v1/models`; committed snapshot: `resources/qwen-bailian-model-catalog.json`)
- Zhipu model overview (text + vision): https://docs.bigmodel.cn/cn/guide/start/model-overview
- Regenerate Zhipu GLM families: `npm run catalog:zhipu` (optional `ZHIPU_API_KEY` merges `GET /paas/v4/models`; card source: `resources/zhipu-model-cards.json`; snapshot: `resources/zhipu-bigmodel-model-catalog.json`)
- Zhipu transient API errors (429 / business codes 1302, 1305, 1308, 1312): https://docs.bigmodel.cn/cn/faq/api-code — retried in provider `executeWithRetry` and Host UI chat integration fallback
- Host UI chat model profiles: `src/e2e/hostUi/chat/hostUiModelProfiles.ts` (snapshot: `resources/host-ui-model-profiles.json`). Override per profile: `COPILOT_BRO_UI_SMOKE_MODEL_PROFILE_<PROFILE>` e.g. `COPILOT_BRO_UI_SMOKE_MODEL_PROFILE_DEEPSEEK_TEXT=deepseek-v4-flash::deepseek`
- Qwen VL (OpenAI compatible): https://www.alibabacloud.com/help/en/model-studio/qwen-vl-compatible-with-openai
- Qwen via Chat Completions: https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions
- Qwen via Responses API: https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses
- DashScope Responses compatibility: https://www.alibabacloud.com/help/en/model-studio/compatibility-with-openai-responses-api

## Memory / context references (plan p8)

- claude-mem: https://github.com/thedotmack/claude-mem
- rtk: https://github.com/rtk-ai/rtk

## Reference Extensions

- Vizards DeepSeek V4 provider: https://github.com/Vizards/deepseek-v4-for-copilot
- MiniMax VS Code provider: https://github.com/zelosleone/minimax-vscode
- GLM provider: https://github.com/zelosleone/glm-chat-provider
- Z.AI provider: https://github.com/Ryosuke-Asano/zai-provider-extension
- Qwen Copilot provider: https://github.com/zelosleone/Qwen-Copilot
- Kimi Copilot provider: https://github.com/zelosleone/kimi-lm-copilot-provider

## Current Notes

- DeepSeek V4 presets use a 1,048,576 token context window. The default output budget stays at 32,768 tokens for practical Agent reliability and cost control, while the UI hint allows the larger provider range up to 393,216.
- MiniMax M2 presets use `reasoning_split: true` so reasoning can be parsed separately from visible content.
- Kimi catalog: `kimi-k2.6`, `kimi-k2.5`, Moonshot V1 text/vision ids. Thinking uses `{ type: "enabled" }`; only `kimi-k2.5` / `kimi-k2.6` also send `keep: "all"`.
