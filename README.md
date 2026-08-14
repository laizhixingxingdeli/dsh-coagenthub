# dsh-coagenthub

DeepSeek Harness(`dsh`)插件:把 CoAgentHub(局域网多参与者协作中枢)的工具与界面嵌入 dsh。

## 形态

- **一期:工具集**——dsh agent 通过对话操作 CoAgentHub(列参与者/建群/发消息/下发任务/查任务)
- **二期:浏览器半**——群列表面板挂到 dsh 三栏 slot(未实现)
- **三期:任务面板**——面板升级为「群列表 | 任务」双 Tab:群列表沿用二期;任务 Tab 选群后展示该群任务全貌(状态徽章/执行器/摘要/attempt 时间线/输出 tail,支持复制任务 id、15s 自动刷新 running 任务)
- **四期:执行器 Tab**——面板升级为「群列表 | 任务 | 执行器」三 Tab:执行器 Tab 列出全部执行器(key/agentName/bin/args/内置徽章/model),非内置可删除(confirm 后 DELETE)、复制 key;折叠式新增表单(POST key/kind/agentName/bin/args/model,kind 默认 cli),内置行不提供删除

## 安装

需要 Node ≥ 22.18(原生 TS type stripping,包入口直接指向 `src/*.ts`,无需构建步骤)。
依赖 dsh 运行时相关包(peerDependencies,从 npm 已发布的 rc 包解析):

```sh
pnpm install
```

## 用法(一期)

用 overlay 方式把本插件插入 dsh web 配置:

```sh
dsh web --patch /path/to/dsh-coagenthub/cordis.yml
```

插件通过 HTTP 调 CoAgentHub API(默认 `http://localhost:3001/api`)。CoAgentHub 无认证,
身份通过 `X-Participant-Id` header 声明;缺省不带头,请求失败回落 Local User。

### 配置与环境变量

| 配置项 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `apiBase` | `COAGENTHUB_API_BASE` | `http://localhost:3001/api` | CoAgentHub API 地址 |
| `participantId` | `COAGENTHUB_PARTICIPANT_ID` | 无 | 身份声明,缺省不发送 `X-Participant-Id` |

插件 config 在 `cordis.yml` 的 `config:` 段给出,例如:

```yaml
- insert:
    - id: coagenthub
      name: '@laizhixingxingdeli/dsh-coagenthub'
      config:
        apiBase: http://localhost:3001/api
        participantId: 019ff626-8a19-701f-aa30-a5c05ae58c45
```

### 工具清单

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `coagenthub_list_participants` | — | 列出参与者(id/name/type/device/在线状态) |
| `coagenthub_create_group` | `title` | 建群,返回 id/title/status |
| `coagenthub_post_message` | `groupId`、`body`、`audience?`(默认 broadcast)、`audienceRef?` | 群消息 |
| `coagenthub_dispatch_task` | `groupId`、`body`、`executorName?`(默认 AtomCode) | 找名字含 executorName 的参与者,发定向消息触发任务;返回消息 id |
| `coagenthub_list_tasks` | `groupId` | 任务列表(id/status/executor/summary/时间) |
| `coagenthub_get_messages` | `groupId`、`after?` | 消息列表(增量,按创建时间倒序) |

典型闭环:建群 → 发任务 → 查状态:

```text
1. coagenthub_create_group(title="我的任务群")
2. coagenthub_dispatch_task(groupId=<上一步 id>, body="实现登录页", executorName="AtomCode")
3. coagenthub_list_tasks(groupId=<上一步 id>)   # 轮询 status
```

## 浏览器半(三期:任务面板)

dsh web 页面右上角悬浮一个 **CoAgentHub 面板**(`shell.overlay` seat,320px):

- **群列表 Tab**:群列表 + 状态,点击行复制群 id。
- **任务 Tab**:顶部下拉选群(复用群列表数据),下方展示该群任务:状态徽章(排队中=黄、执行中=绿点脉冲、已完成=绿、失败=红、已取消=灰)、执行器、摘要(前 60 字)、相对时间;点击行展开详情(brief 前 300 字、attempt 时间线「第 N 次 失败 exit 1 → 第 2 次 成功 abc1234」、diffSummary error / 输出 tail,均最多 2000 字)。每行可复制任务 id,顶部按钮手动刷新;选中群后每 15s 自动刷新(running 任务实时跟进)。
- **执行器 Tab**:列出全部执行器(key/agentName/bin/args 截断/内置徽章「内置」/model 有则显示),非内置行可删除(confirm 后 DELETE,失败显示错误)、每行复制 key;「新增执行器」展开折叠表单(key、kind 必填,kind 默认 cli,agentName/bin/args/model 可空),提交 POST 成功即刷新并清空表单。
- 数据经同源代理 `/coagenthub-api`(host 半 `coagenthub-proxy`)拉取,`GET /groups/:id/tasks?includeOutput=1`、`GET/POST /executors`、`DELETE /executors/:key`(内置被拒 409)。

构建浏览器半 bundle:

```sh
node scripts/build-client.mjs   # 产出 lib/client.js(dsh web 启动时加载)
```

验证(需本机 dsh web + CoAgentHub 运行中):打开 `http://localhost:3080`,面板应显示「群列表 | 任务 | 执行器」三 Tab,选群后出现真实任务行,执行器 Tab 出现真实执行器列表。

## 测试

```sh
pnpm test        # vitest:client 单测 + tools 单测(全部 mock,不依赖真服务)
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

前提:Mac 的 CoAgentHub server 已运行(监听 `0.0.0.0:3001`,局域网可达);Windows 与 Mac 同一局域网。

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
- 插件 host 半的代理在 Windows 本地运行(转发到 Mac),浏览器无 CORS 问题;headless 模式(Node 直连)同样可用。
- Windows 的 dsh 面板/工具与 Mac 网页看到的是同一个 CoAgentHub。


## 分工模式:Windows 指挥 Mac 干活(方案 B)

dsh 的工作区是**运行 dsh 的机器本地目录**。Windows 的 dsh 无需访问 Mac 的文件系统:

1. **工作区**:在 Windows 上选任意本地目录(如 `C:\\projects\\dsh-workspace`)——它只是 dsh agent 的本地沙箱,不需要包含 Mac 项目。
2. **操作 Mac 的 CoAgentHub**:面板(或对话)用工具完成:
   - 列参与者/群:`coagenthub_list_participants` / `coagenthub_list_groups`
   - 下发任务给 Mac 执行器:`coagenthub_dispatch_task`(任务书写明项目路径,Mac 上的执行器会在 Mac 本地仓库干活、提交、汇报)
   - 查进度/结果:`coagenthub_list_tasks` / `coagenthub_get_messages`(含实时输出)
3. **效果**:Windows dsh = 指挥台;Mac 执行器 = 干活的工人;文件系统互不共享,各自原生性能;任务书/汇报/文件信令全走 CoAgentHub。
4. 想直接看 Mac 仓库文件时,再用方案 A(SMB 映射)只读浏览。

> 提示:dispatch_task 的任务书应包含目标项目路径(执行器以群绑定的 project_path 为准;多项目时确保群已绑定 Mac 上的正确目录)。
