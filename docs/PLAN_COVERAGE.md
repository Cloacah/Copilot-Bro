# 计划覆盖索引

> 执行与验收的**唯一入口**为 [`plan/VISION_FLOW_MASTER.plan.md`](../plan/VISION_FLOW_MASTER.plan.md)。  
> 代码结构分阶段清单见 [`plan/CODE_STRUCTURE_OPTIMIZATION.plan.md`](../plan/CODE_STRUCTURE_OPTIMIZATION.plan.md)。

## 阶段速查（p0–p11）

| 阶段 | 主题 | 验收要点 |
|------|------|----------|
| p0 | 范围与证据基线 | 日志 marker、plan 单测 |
| p1 | 快速修复与门禁 | 设置面板、wrapped 降级、`npm test` |
| p2 | Host UI 真实自动化 | `npm run test:host-ui:chat-acceptance` |
| p3 | 识图日志与缓存 | `vision.input.bound`、`vision.proxy.cache.*` |
| p4 | 路由契约 | self-refer、raw image guard |
| p5 | Qwen 目录与探针 | 模型版本 UI、provider 探针 |
| p6 | 证据与任务栈 | `vision.evidence.persisted`、path hydration |
| p7 | 结构化识图与产物 | 高保真文本契约；**图像后处理链当前暂停** |
| p8 | 记忆与 token | budgeter 探针（长期记忆 ⏸） |
| p9 | README | `npm run readme:check` |
| p10 | 打包 | `npm run package:verify` |
| p11 | 终审 | `planCoverageAudit` + 全量单测 |

## Host UI 推荐命令

| 命令 | 说明 |
|------|------|
| `npm run test:host-ui:chat-acceptance` | GitHub 登录预检 + 多供应商 Chat 集成（`scripts/host-ui/run-host-ui-chat-acceptance.mjs`） |
| `npm run test:host-ui:full` | `COPILOT_BRO_UI_SMOKE_E2E=all` 全套件 |
| `npm run test:host-ui:analyze-chat` | 解析最近一次 chat jsonl / smoke 日志 |

## 识图路由（当前生产）

- **proxy**：文本模型通过另一视觉模型生成结构化描述，再替换原图进入主模型。  
- **native**：模型自带 `vision: true` 时，扩展内直连高保真结构化 pass（与 proxy **同契约**）；全局关闭代理时优先 native。  
- **防套娃**：`visionOrchestrationContext` 抑制嵌套识图；代理仅单层。  
- **纯色/低细节图**：格式校验失败时使用 `vision.*.structured.format-fallback`，仍写入 `vision.evidence.persisted`。
