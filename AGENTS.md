# AGENTS.md

`dsh-coagenthub`:DeepSeek Harness(dsh)插件,让 dsh agent 用对话工具操作
CoAgentHub(列参与者 / 建群 / 发消息 / 派任务 / 查任务 / 通知),并在 dsh web 挂一个浏览器
指挥台面板。代码分 **host 半**(`src/` 的 Node 侧逻辑:工具 / 代理 / 后台事件)与
**browser 半**(`src/client-ui/` + `scripts/build-client.mjs` 产出的 `lib/client.js`)。

这是给代码助手的**入口**:只列命令、不变量与文档指针,细节下沉到正文链接,别在这里堆易过时的具体描述。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm test` | vitest 全量单测(client / tools / host 逻辑 / 面板组件,全部 mock,不依赖真服务) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm smoke` | 真 API 冒烟(需本机 CoAgentHub 在 `localhost:3001`;默认 skip,设 `COAGENTHUB_SMOKE=1` 后执行) |
| `pnpm build` | `tsc -p tsconfig.build.json` → `dist/`(host 半产物) |
| `node scripts/build-client.mjs` | esbuild 打包浏览器半 → `lib/client.js`(dsh web 启动时加载) |
| `pnpm prepublishOnly` | 发版前自动 `build` + build-client,由维护者触发 |

## 惯例与不变量

- **工具统一注册在 `src/tools.ts`**:返回结构都在文件顶部的 `XXXX_VIEW_SCHEMA`;改动输出必须同步 schema(避免 lossless JSON 校验失败)。
- **纯函数放旁路模块**:任务书渲染在 `src/task-book.ts`(无 I/O);群/路径解析等纯逻辑在 `src/workspace.ts` / `src/workspace-instructions.ts`,利于单测。
- **groupId 解析顺序固定**:显式传值 → 当前会话 per-session 映射(须在群列表)→ 会话 cwd 反查;有会话 id 时**绝不回退**全局 `activeGroupId`,无会话 id 才以它兜底。会话 cwd 一律取 exec / live agent 的会话目录,**绝不回退 `process.cwd()`**。
- **后台事件走 durable inbox,不猜终态**:终态只由 `task_completion_available` 提示帧 + 30s 兜底定时器触发 `CompletionConsumer.consume()`(list → claim → followup → dedupe 记录 → ack/fail),`DedupeStore` 保证 at-most-one followup;不要回到「按任务快照轮询推断终态」。`task_stall_alert` 直接投递非终态通知,不进 inbox。
- **文档单一事实源**:架构分层 / 工具清单 / 后台事件链路 / 配置细节只在 `README.md` 一处;`COAGENTHUB.md` 是给工作区 agent 读的**操作指令**(角色 / 流程 / 路径规则),不含架构细节。改行为先改 README。
- **不要写死本机路径**:文件路径、`DSH_HOME` 等一律运行时解析,文档与代码都不写死绝对路径。

## 文档指针

- [`README.md`](README.md) —— 总览:功能、命令、配置与环境变量、**工具清单**、浏览器面板、**架构分层表**、**后台事件链路**、虚拟工作区、发布流程、变更记录。
- [`COAGENTHUB.md`](COAGENTHUB.md) —— 工作区常驻操作指令(角色分工 / 新会话流程 / 本地路径硬规则 / 先讨论再下发 / 执行器选择);由 `coagenthub_get_workspace_instructions` 读出。
- `cordis.yml` —— 插件插入 dsh web 的 patch overlay(含 `coagenthub` 与 web-only 的 `coagenthub-proxy` 两个插件)。

新增 / 重命名 `src/` 下的模块后,同步更新 README 的「架构分层」表,保持单一事实源。