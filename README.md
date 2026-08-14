# dsh-coagenthub

DeepSeek Harness(`dsh`)插件:把 CoAgentHub(局域网多参与者协作中枢)的工具与界面嵌入 dsh。

## 形态

- **一期:工具集**——dsh agent 通过对话操作 CoAgentHub(列参与者/建群/发消息/下发任务/查任务)
- **二期:浏览器半**——群列表/任务面板等 React 组件挂到 dsh 三栏 slot(未实现)

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
3. coagenthub_list_tasks(groupId=<id>)   # 轮询 status
```

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
