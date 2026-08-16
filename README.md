# dsh-coagenthub

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)
[![Version](https://img.shields.io/badge/version-0.0.20-2ea44f.svg)](https://github.com/laizhixingxingdeli/dsh-coagenthub)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/laizhixingxingdeli/dsh-coagenthub/issues)

DeepSeek Harness(`dsh`)插件:把 [CoAgentHub](https://github.com/laizhixingxingdeli/CoAgentHub)
(局域网规模的多 participant 协作中枢)的工具与界面嵌入 dsh。dsh agent 通过对话操作
CoAgentHub(列参与者 / 建群 / 发消息 / 下发任务 / 查任务),浏览器面板提供
「群列表 | 任务 | 执行器 | 设置」四 Tab 指挥台,Windows 侧 agent 可作为「分析 / 拆任务 /
验收」的指挥官,把实现类任务下发给局域网内的执行器。

> **安全提示**:CoAgentHub 当前无鉴权——局域网全信(LAN full-trust)模型,任何能访问
> 局域网的人都能注册 participant、建群、发消息。身份通过 `X-Participant-Id` header
> 声明,请勿将 CoAgentHub 直接暴露公网。

## 功能特性

- **对话操作 CoAgentHub** — 18 个工具覆盖全链路:参与者 / 群 / 成员 / 消息 / 任务 /
  执行器 / 通知,agent 全程可追溯(见[工具清单](#工具清单))。
- **结构化任务书** — `coagenthub_dispatch_task` 支持 `goal / scope / acceptance /
  tests / report / priority / dependencies` 结构化字段,自动渲染成 Markdown 任务书;
  只传 `body` 时原样发送,完全兼容。
- **groupId 自动回填** — 工具不必每次传 `groupId`:显式传值优先,否则按当前会话
  cwd 反查匹配群,再回落面板选中的活动群(activeGroupId)。
- **后台任务事件推送** — WS 订阅 + 低频轮询兜底;dsh 运行时可用时通过
  `agent.followup` 主动唤醒会话,否则通知入队由 `coagenthub_get_notifications` 补读,
  通知不丢、按会话隔离。
- **浏览器指挥台面板** — dsh web 右上角悬浮面板:群列表 / 任务 / 执行器 / 设置四 Tab,
  可拖动、可调大小,位置与大小记忆;任务行展示状态徽章、attempt 时间线、输出 tail,
  15s 自动刷新 running 任务,新 Tab 打开完整原始输出。
- **虚拟工作区(Windows 一键设置)** — 绑定 project_path 的群自动成为虚拟工作区;
  面板一键 `net use` 映射 Mac 共享、推断路径映射规则、把群注册为 dsh 工作区,
  当前工作区随 dsh 会话记忆。
- **工作区级指令** — 插件工作区的 `COAGENTHUB.md` 由
  `coagenthub_get_workspace_instructions` 原样读出,Windows 侧指挥官按指令行事。

## 形态(演进)

- **一期:工具集** — dsh agent 通过对话操作 CoAgentHub
- **二期:浏览器半** — 群列表面板挂到 dsh 三栏 slot
- **三期:任务面板** — 面板升级为「群列表 | 任务」双 Tab(状态徽章 / 执行器 / 摘要 /
  attempt 时间线 / 输出 tail,15s 自动刷新 running 任务)
- **四期:执行器 Tab** — 面板升级为「群列表 | 任务 | 执行器」三 Tab(执行器列表 /
  新增 / 删除 / 复制 key)
- **五期:指挥官指挥台** — 面板四 Tab(新增「设置」,含身份与虚拟工作区);新增
  5+ 个工具(群 / 执行器 / 任务 / 通知查询)、`coagenthub_dispatch_task` 结构化任务书、
  工作区级指令 `COAGENTHUB.md`、后台 WS 订阅 + 任务状态主动推送

## 快速开始

需要 **Node ≥ 22.18**。依赖 dsh 运行时相关包(peerDependencies,从 npm 已发布的 rc
包解析),安装:

```sh
pnpm install
```

用 overlay 方式把本插件插入 dsh web 配置(`cordis.yml` 已随仓库提供):

```sh
dsh web --patch /path/to/dsh-coagenthub/cordis.yml
```

插件通过 HTTP 调 CoAgentHub API(默认 `http://localhost:3001/api`)。CoAgentHub 无认证,
身份通过 `X-Participant-Id` header 声明;缺省不带头,请求失败回落 Local User。

> 包入口指向构建产物(`main: dist/index.js`,exports 提供 `./client` / `./tools` /
> `./proxy`),发布前由 `prepublishOnly` 自动构建。本地开发:

> ```sh
> pnpm build   # tsc -p tsconfig.build.json → dist/
> node scripts/build-client.mjs   # esbuild 浏览器半 bundle → lib/client.js
> ```

## 配置与环境变量

| 配置项 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `apiBase` | `COAGENTHUB_API_BASE` | `http://localhost:3001/api` | CoAgentHub API 地址 |
| `participantId` | `COAGENTHUB_PARTICIPANT_ID` | 无 | 身份声明,缺省不发送 `X-Participant-Id` |

解析优先级:**面板设置 > 插件 config(`cordis.yml`) > 环境变量 > 默认值**,每次请求
现查,面板保存后即时生效,无需重启。

插件 config 在 `cordis.yml` 的 `config:` 段给出,例如:

```yaml
- insert:
    - id: coagenthub
      name: '@laizhixingxingdeli/dsh-coagenthub'
      config:
        apiBase: http://localhost:3001/api
        participantId: 019ff626-8a19-701f-aa30-a5c05ae58c45
```

### 设置持久化路径

面板「设置」里保存的 `apiBase` / `participantId` / `mappingRule` / `activeGroupId`
由 host 半写入磁盘,重启 dsh web 后自动恢复,路径规则:

| 环境变量 | 持久化文件 |
| --- | --- |
| `DSH_HOME` 已设置(旧版路径,优先) | `$DSH_HOME/coagenthub-config.json` |
| `DSH_HOME` 未设置或为空 | `~/.dsh/coagenthub-config.json`(Windows 常见,默认落盘于此) |

写/读失败不阻塞:设置保留在内存继续生效,下次启动再从磁盘尽力恢复(失败则回落内存)。

## 工具清单

共 **18 个工具**(`src/tools.ts`)。`groupId` 大多可选:不传时自动回填
(当前会话 cwd 反查匹配群 → activeGroupId 兜底 → 都找不到则报错提示手动传)。

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `coagenthub_list_participants` | — | 列出参与者(id/name/type/device/online/lastSeen;name 含「执行器」→ `executor`,「Local User」→ `local`) |
| `coagenthub_create_group` | `title` | 建群,返回 id/title/status |
| `coagenthub_post_message` | `groupId?`、`body`、`audience?`(默认 broadcast)、`audienceRef?` | 群消息 |
| `coagenthub_dispatch_task` | `groupId?`、`body`、`executorName?`(默认 AtomCode)、`goal?/scope?/acceptance?/tests?/report?/priority?/dependencies?` | 找名字含 executorName 的参与者,发定向消息触发任务;结构化字段渲染成 Markdown 任务书(只传 body 时原样发送);返回 messageId + 执行器 id/name;403 提示无权限 |
| `coagenthub_list_tasks` | `groupId?` | 任务列表(id/status/executor 名/summary 前 200 字/时间) |
| `coagenthub_get_task` | `groupId?`、`taskId` | 单个任务(id/status/executor/brief/retryCount/attempts/diffSummary/outputTail);404 时提示「messageId ≠ taskId」误用 |
| `coagenthub_update_task` | `groupId?`、`taskId`、`brief` | 修改任务书(仅排队中的任务可改;409/403 错误信息透出) |
| `coagenthub_list_groups` | `limit?`(默认 100)、`status?`(`active`/`archived`) | 群列表(id/title/status/projectPath;带 status 过滤时先全量过滤再截断) |
| `coagenthub_get_group` | `groupId?` | 单个群(id/title/status/projectPath/members) |
| `coagenthub_get_group_members` | `groupId?` | 群成员分工信息(participantId/name/device/roles/prompt/joinedAt) |
| `coagenthub_update_group` | `groupId?`、`title?`、`projectPath?` | 改群标题 / 项目绑定;`projectPath` 传空串清除绑定(至少传一个字段) |
| `coagenthub_add_group_member` | `groupId?`、`participantId`、`roles?`(默认 `["executor"]`) | 加成员,返回服务端成员行 |
| `coagenthub_remove_group_member` | `groupId?`、`participantId` | 移除成员,成功返回 `{ ok: true }` |
| `coagenthub_get_messages` | `groupId?`、`after?` | 消息列表(增量,按创建时间倒序) |
| `coagenthub_list_executors` | — | 列出注册执行器(key/agentName/kind/bin/url/model/device/online) |
| `coagenthub_get_active_group` | — | 当前虚拟工作区 `{ groupId, groupTitle, projectPath?, winPath?, instructions? }`;未选择返回 null |
| `coagenthub_get_workspace_instructions` | — | 读取当前工作区根目录 `COAGENTHUB.md` 指令 `{ groupId, groupTitle, instructions }`;非插件工作区返回 `instructions: null` |
| `coagenthub_get_notifications` | — | 返回并清空**当前会话所在群**的后台事件通知(task.completed/failed/stalled/status_changed、message.received),按会话 cwd 隔离;主动推送不可用时自动成为回退通道 |

典型闭环:建群 → 发任务 → 查状态:

```text
1. coagenthub_create_group(title="我的任务群")
2. coagenthub_dispatch_task(groupId=<上一步 id>, body="实现登录页", executorName="AtomCode")
3. coagenthub_list_tasks(groupId=<上一步 id>)   # 轮询 status
```

## 浏览器面板(指挥台)

dsh web 页面右上角悬浮一个 **CoAgentHub 面板**(`shell.overlay` seat,320px),四 Tab:
「群列表 | 任务 | 执行器 | 设置」。

- **面板外壳**:拖动标题栏可移动面板,位置存 `localStorage`(`coagenthub.panelPosition`,
  默认右上角,刷新后恢复,移动时至少保留 48px 在视口内);右下角拖拽手柄可调大小
  (`coagenthub.panelSize`)。
- **群列表 Tab**:群列表 + 状态,点击行复制群 id。
- **任务 Tab**:顶部下拉选群(复用群列表数据),下方展示该群任务:状态徽章(排队中=黄、
  执行中=绿点脉冲、已完成=绿、失败=红、已取消=灰)、执行器、摘要(前 60 字)、相对时间;
  点击行展开详情(brief 前 300 字、attempt 时间线「第 N 次 失败 exit 1 → 第 2 次 成功
  abc1234」、diffSummary error / 输出 tail,均最多 2000 字)。每行可复制任务 id,顶部
  按钮手动刷新;选中群后每 15s 自动刷新(running 任务实时跟进);行内按钮在新浏览器
  Tab 打开完整原始输出(`/coagenthub-api/raw/<taskId>` 纯文本)。
- **执行器 Tab**:列出全部执行器(key/agentName/bin/args 截断/内置徽章「内置」/model
  有则显示),非内置行可删除(confirm 后 DELETE,失败显示错误)、每行复制 key;
  「新增执行器」展开折叠表单(key、kind 必填,kind 默认 cli,agentName/bin/args/model
  可空),提交 POST 成功即刷新并清空表单。
- **设置 Tab**:当前身份与工作区(participantId、当前工作区群名,随 dsh 会话记忆)+
  「虚拟工作区」一键设置(见下文);apiBase / participantId 修改即时生效。
- 数据经同源代理 `/coagenthub-api`(host 半 `coagenthub-proxy`)拉取,
  `GET /groups/:id/tasks?includeOutput=1`、`GET/POST /executors`、
  `DELETE /executors/:key`(内置被拒 409)。

构建浏览器半 bundle:

```sh
node scripts/build-client.mjs   # 产出 lib/client.js(dsh web 启动时加载)
```

验证(需本机 dsh web + CoAgentHub 运行中):打开 `http://localhost:3080`,面板应显示
「群列表 | 任务 | 执行器 | 设置」四 Tab,选群后出现真实任务行,执行器 Tab 出现真实
执行器列表。

## 架构分层

| 文件 | 职责 |
| --- | --- |
| `src/client.ts` | 纯 HTTP 客户端(不读本地文件、不做业务判断);apiBase/participantId 解析链:设置 > config > 环境变量 > 默认;`getTask` 优先单查端点,404/405 回落 `listTasks` 过滤 |
| `src/tools.ts` | 薄工具层:参数校验 + 调 client + 格式化输出;18 个工具;`resolveGroupId` 统一做 groupId 自动回填(显式 → 会话 cwd 反查 → activeGroupId) |
| `src/task-book.ts` | 纯函数 `buildTaskBook`:把 `dispatch_task` 的结构化字段(goal/scope/acceptance/tests/report/priority/dependencies)渲染成 Markdown 任务书;无结构化字段时原样透传 body |
| `src/workspace-instructions.ts` | 会话 cwd 解析(`agent.session.header.cwd`,旧结构 `meta.cwd`,live root agent 回退;**不回退 process.cwd()**)+ 读取工作区根目录 `COAGENTHUB.md` |
| `src/workspace.ts` | 虚拟工作区 host 逻辑:Mac→Win 路径映射 / 前缀推断 / net use 参数 / 一键设置 / 状态;纯函数与 IO 分离,全部可单测 |
| `src/config.ts` | 运行时设置(apiBase / participantId / mappingRule / activeGroupId),host 半持久化到 `$DSH_HOME`(或 `~/.dsh`) |
| `src/ws-client.ts` | Node 侧 WebSocket 客户端:`<apiBase>/ws?participantId=<id>`,指数退避重连 1s→30s,身份变化自动重连 |
| `src/task-watcher.ts` | 后台任务状态监测:订阅 `group_message` / `task_output` / `task_stall_alert` / `task_status_changed` 帧 + 低频轮询(4s)兜底,检测 queued→running→done/failed 变化;事件不做群过滤,隔离在 drain 时按会话 cwd 进行 |
| `src/notification-queue.ts` | 内存通知队列(容量 200):task.completed / task.failed / task.stalled / task.status_changed / message.received |
| `src/notify.ts` | 通知投递适配层:`PushAdapter` 抽象 + `DshAgentPushAdapter`(dsh `agent.followup` 排队 next-turn 消息并唤醒 driver)/ `NullPushAdapter`(回退入队 + 日志说明);deliverer 推送失败自动回落队列 |
| `src/proxy.ts` | host 半同源代理(web-only):`/coagenthub-api/*` 转发到 CoAgentHub + 设置端点(`/coagenthub-api-config`)+ 原始输出端点(`/coagenthub-api/raw/<taskId>`)+ 虚拟工作区端点(`workspace-setup` / `workspace-status`);headless profile 无 `webServer` 时自动跳过 |
| `src/client-ui/*` | 浏览器半四 Tab 面板(群列表/任务/执行器/设置 + 虚拟工作区 + 可拖动外壳),不实现 agent 工具 |
| `COAGENTHUB.md` | 插件工作区常驻指令,`coagenthub_get_workspace_instructions` / `coagenthub_get_active_group` 读取 |

后台事件链路(B 方案):`TaskWatcher` 接 WS 帧并做低频轮询兜底 → `notify.ts` 适配层:
运行时暴露 `ctx.agents` 注册表时用 `DshAgentPushAdapter` 主动唤醒 dsh 会话
(`agent.followup` 排队 next-turn 消息,plugin 来源;推送前按会话 cwd 反查群做隔离),
否则回落 `NullPushAdapter` 入队;`coagenthub_get_notifications` 始终可补读,替代轮询
查任务状态。

### 主动推送支持状态(已通过 agent.followup 实现真正唤醒)

调研结论(`@deepseek-ai/dsh-agent` 0.1.0-rc.6 / `@deepseek-ai/dsh-llm` 0.1.0-rc.6 源码):

- **唤醒能力存在**:dsh 运行时在 `Agent` 上暴露 `followup(UserMessage)`(runtime-types.d.ts),
  把普通 next-turn 消息排队并唤醒 driver,正是「后台任务完成后向 agent 汇报并唤醒会话」
  的语义;`createUserMessage({ content, source: { kind: 'plugin', plugin } })` 可构造合法
  UserMessage(自动生成稳定 id,plugin 来源官方支持)。
- **后台上下文无稳定 agent 句柄**:插件 `apply(ctx)` 的根上下文上 `ctx.agent` 为
  undefined(仅 agent 作用域上下文中有),因此本插件通过 `ctx.agents`(AgentRegistry)
  在每次推送时解析 live root agent;该服务经 `ctx.inject(['agents'], …)` 动态注入,
  可用时切到主动推送,下线时自动回退队列。
- **回退行为**:运行时未暴露 `ctx.agents` 时插件记录 warn 日志并回落 `NullPushAdapter`
  (通知入队),`coagenthub_get_notifications` 补读;推送抛错/拒绝同样回落队列,通知不丢。
- **会话隔离**:推送/拉取都按会话 cwd 反查群,只投递当前会话所在群的通知,其他群的
  通知留在队列,不会串入当前会话。

## 测试

```sh
pnpm test        # vitest:client 单测 + tools 单测 + host 逻辑单测 + 面板组件测试(全部 mock,不依赖真服务)
pnpm typecheck   # tsc --noEmit
pnpm smoke       # 真 API 冒烟:需本机 CoAgentHub 运行在 localhost:3001
```

冒烟测试默认 skip,设置环境变量 `COAGENTHUB_SMOKE=1` 后跑:
列参与者 → 建唯一名群 → 发广播消息 → 查任务(允许为空)→ 列消息,全链路断言成功。

## 开发

```sh
pnpm install
pnpm test
pnpm typecheck
```

## Windows 接入(连 Mac 上的 CoAgentHub)

前提:Mac 的 CoAgentHub server 已运行(监听 `0.0.0.0:3001`,局域网可达);Windows 与 Mac
同一局域网。

```powershell
# 1. 安装 dsh(Windows)
npx @deepseek-ai/dsh web          # 首次会启动 Web UI(:3080)

# 2. 在 dsh 的 profile 里安装插件
#    DSH_HOME 默认在用户目录;进 web profile 目录后:
cd $env:USERPROFILE\.dsh\profiles\web
pnpm add @laizhixingxingdeli/dsh-coagenthub

# 3. 注册一个 Windows 身份(任意终端)
#    POST http://<mac-lan-ip>:3001/api/participants  {"name":"Win dsh"}
#    记下返回的 id

# 4. 用 --patch 启动,插件指向 Mac
npx @deepseek-ai/dsh web --patch .\cordis.yml
```

`cordis.yml`(Windows 版):

```yaml
- insert:
    - id: coagenthub
      name: '@laizhixingxingdeli/dsh-coagenthub'
      config:
        apiBase: http://<mac-lan-ip>:3001/api
        participantId: <Win dsh 的 id>
```

插件未发布前可用本地路径替代 npm 包:`pnpm add /path/to/dsh-coagenthub`。

说明:

- 全信化模型:身份只认 id,无 token;同名 participant 会冲突,Windows 注册时换一个名字即可。
- 插件 host 半的代理在 Windows 本地运行(转发到 Mac),浏览器无 CORS 问题;headless
  模式(Node 直连)同样可用。
- Windows 的 dsh 面板/工具与 Mac 网页看到的是同一个 CoAgentHub。

## 分工模式:Windows 指挥 Mac 干活(方案 B)

dsh 的工作区是**运行 dsh 的机器本地目录**。Windows 的 dsh 无需访问 Mac 的文件系统:

1. **工作区**:在 Windows 上选任意本地目录(如 `C:\projects\dsh-workspace`)——它只是
   dsh agent 的本地沙箱,不需要包含 Mac 项目。
2. **操作 Mac 的 CoAgentHub**:面板(或对话)用工具完成:
   - 列参与者/群:`coagenthub_list_participants` / `coagenthub_list_groups`
   - 下发任务给 Mac 执行器:`coagenthub_dispatch_task`(任务书写明项目路径,Mac 上的
     执行器会在 Mac 本地仓库干活、提交、汇报)
   - 查进度/结果:`coagenthub_list_tasks` / `coagenthub_get_messages`(含实时输出)/
     `coagenthub_get_notifications`(后台事件,可主动推送)
3. **效果**:Windows dsh = 指挥台;Mac 执行器 = 干活的工人;文件系统互不共享,各自
   原生性能;任务书/汇报/文件信令全走 CoAgentHub。
4. 想直接看 Mac 仓库文件时,再用方案 A(SMB 映射)只读浏览。

> 提示:dispatch_task 的任务书应包含目标项目路径(执行器以群绑定的 project_path 为准;
> 多项目时确保群已绑定 Mac 上的正确目录)。

## 虚拟工作区(Windows 一键设置)

每个绑定 project_path 的群自动成为一个「虚拟工作区」。Windows 上可在面板
「设置 → 虚拟工作区」一键配置:

1. 填 Mac 共享名(如 Projects)+ 可选账号/密码 + 盘符(默认 Z)
2. 插件自动:`net use` 映射网络驱动器(先释放盘符保证幂等)→ 推断 Mac→Win 路径规则
   → 把群注册为 dsh 工作区(已注册的更新标题,不重复注册)
3. dsh 工作区选择器出现「群名」,选中即锁定该群(面板同步,并按 dsh 会话记忆)

会话与群的绑定按**会话 cwd 反查**(`findGroupByWorkspaceCwd`),不回退
`process.cwd()`——避免常驻 web 进程把会话误判到 dsh 启动目录绑定的群。

前置:Mac 需开启文件共享(SMB),Win 首次需 Mac 共享凭据。

## 发布流程(约定)

**先本地/Win 验证,再发 npm。**

1. 功能开发 → 提交推送 GitHub(`main`),**不发布 npm**。
2. Windows 验证(两种方式):
   - 本地路径:`git clone` 到 Win 后 `pnpm add D:\path\to\dsh-coagenthub`
   - 或 Git 直装:`pnpm add git+https://github.com/laizhixingxingdeli/dsh-coagenthub.git`
3. Win 验证通过后,再由维护者执行 `npm publish`(token 见仓库维护者)。
4. 紧急修复可直接发版,但常规迭代遵循上述节奏。

> 发布命令:`npm publish --registry https://registry.npmjs.org --//registry.npmjs.org/:_authToken=$NPM_TOKEN`
> (`prepublishOnly` 会自动执行 `pnpm build && node scripts/build-client.mjs`)

## 变更记录

### 0.0.20

- 虚拟工作区按**会话所在目录**反查群,移除 `process.cwd()` 误判

### 0.0.19

- `workspace-instructions` 读取 `agent.session.header.cwd`(真实字段路径),兼容旧结构
  `session.meta.cwd`

### 0.0.18

- 面板「当前工作区」缺省为「自动(按 cwd)」,保存前不再读取过期全局记忆

### 0.0.17

- 面板按 dsh 会话记忆活动工作区(per-session localStorage)
- 通知主动推送按会话 cwd 隔离(`agent.followup` 只推当前会话所在群)

### 0.0.16

- 工具 `groupId` 自动回填(显式 → 会话 cwd 反查 → activeGroupId 兜底),统一错误提示
- 通知按会话 cwd 反查群隔离(`coagenthub_get_notifications` 只 drain 当前群)
- `get_task` 404 友好提示:messageId ≠ taskId
- 任务 `outputTail` 提升到顶层读取(diffSummary.outputTail 保留兜底);面板去掉完成
  提醒横幅与桌面通知

### 0.0.15

- 新增群管理工具:`coagenthub_update_group` / `coagenthub_add_group_member` /
  `coagenthub_remove_group_member`
- `dispatch_task` 的 `groupId` 可选 + 自动回填
- 任务面板:执行中徽章改蓝色,详情状态去重,执行器显示 participant 名

### 0.0.14

- 新增 `coagenthub_get_group_members` 工具(成员角色 + 分工 prompt)
- 通知只推终态任务(done/failed/stalled),过滤 queued 状态变更噪音

### 0.0.13

- 工具输出归一化,规避 lossless JSON 校验失败;POSIX cwd 匹配修正

### 0.0.12

- 动态注入 `agents` 服务以启用 followup 主动唤醒;服务缺失时安全回退队列

### 0.0.11

- 通知通过 `agent.followup` 真正唤醒 dsh 会话(不再是纯入队)
- 设置 patch 缺省键不再清空其他设置;工具按会话 cwd 解析活动群

### 0.0.10

- 新增 `coagenthub_update_task` 工具支持修改任务书

### 0.0.9

- 任务新完成时面板提醒
- `COAGENTHUB.md` 补充「先讨论再下发」规则、澄清选项编号呈现、禁止猜测本地路径

### 0.0.8

- 修复 `ctx.agents` 未注入导致 dsh web 重启阻断:改为安全探测,agents 缺失时回退通知队列
- 修复 `coagenthub_get_group` / `coagenthub_list_executors` / `coagenthub_list_groups`
  输出含 `undefined` 字段的问题
- 修复 `coagenthub_get_task` 输出 schema 中 `attempts[].error/summary/hash` 缺省补齐为 `null`
- 修复 `workspace-instructions` 读取路径:优先 `session.header.cwd`,兼容回退 `session.meta.cwd`

### 0.0.7

- 面板标题栏可拖动并持久化位置
- 新增工具:`coagenthub_list_groups` / `coagenthub_get_group` / `coagenthub_list_executors` /
  `coagenthub_get_task` / `coagenthub_get_notifications`
- `coagenthub_dispatch_task` 支持结构化任务书字段
- 工作区级指令 `COAGENTHUB.md` + `coagenthub_get_workspace_instructions`
- B 方案后台订阅与主动推送(`ws-client` / `task-watcher` / `notify` / `notification-queue`)
- 设置持久化:`DSH_HOME` 未设置时回退 `~/.dsh/coagenthub-config.json`
- 修复任务面板 `task.attempts` 未防御导致崩溃
- 修复任务面板 15s 自动刷新闪屏

## 维护者

Daniel Jobin([@laizhixingxingdeli](https://github.com/laizhixingxingdeli))。

## 许可证

MIT——见 [LICENSE.md](LICENSE.md)。第三方组件保留各自许可证。
