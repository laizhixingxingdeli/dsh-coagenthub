# dsh-coagenthub

DeepSeek Harness(`dsh`)插件:把 CoAgentHub(局域网多参与者协作中枢)的工具与界面嵌入 dsh。

## 形态

- **一期:工具集**——dsh agent 通过对话操作 CoAgentHub(列参与者/建群/发消息/下发任务/查任务)
- **二期:浏览器半**——群列表/任务面板等 React 组件挂到 dsh 三栏 slot

## 用法(一期)

```sh
dsh web --patch /path/to/dsh-coagenthub/cordis.yml
```

插件通过 HTTP 调 CoAgentHub API(默认 http://localhost:3001/api,身份声明 X-Participant-Id,无认证)。

## 开发

```sh
pnpm install
pnpm test
pnpm exec tsc -b
```
