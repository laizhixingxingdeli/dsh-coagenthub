window.__ModuleLoader__.load({ id: "@laizhixingxingdeli/dsh-coagenthub", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client-ui/index.ts
var index_exports = {};
__export(index_exports, {
  CoAgentHubExecutorsPanel: () => CoAgentHubExecutorsPanel,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client-ui/CoAgentHubPanel.tsx
var import_react5 = require("react");

// src/client-ui/CoAgentHubPanel.module.css
var css = "/* CoAgentHub panel container (browser half). Right-side floating panel with a\n   header (title + tab bar) over a scrolling body that hosts the \u7FA4\u5217\u8868 / \u4EFB\u52A1\n   content components. Styled after the dsh DetailsPanel with the dsw theme\n   aliases so dark mode and future theme changes apply. */\n\n.c03bc34d0_panel {\n  position: fixed;\n  top: 16px;\n  right: 16px;\n  z-index: 100;\n  width: var(--panel-width, 360px);\n  height: var(--panel-height, 620px);\n  max-width: 640px;\n  max-height: 90vh;\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 12px;\n  background: var(--dsw-alias-bg-base);\n  color: var(--dsw-alias-label-primary, #1f2328);\n  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);\n  font-size: 13px;\n  line-height: 1.4;\n  pointer-events: auto;\n}\n\n/* A task detail is expanded: widen the panel instead of opening a new surface. */\n.c03bc34d0_panel[data-detail-open='true'] {\n  width: 480px;\n}\n\n.c75a5b6d7_header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 10px 14px 8px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.cc955129f_title {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 600;\n  letter-spacing: 0.2px;\n  white-space: nowrap;\n  /* \u6807\u9898\u680F\u5373\u62D6\u52A8\u533A:grab \u5149\u6807 + \u7981\u9009\u6587\u672C + \u89E6\u6478\u7AEF\u7981\u7528\u9ED8\u8BA4\u6EDA\u52A8\u3002 */\n  cursor: grab;\n  user-select: none;\n  touch-action: none;\n}\n\n.cc955129f_title:active {\n  cursor: grabbing;\n}\n\n.ca58e5d96_tabs {\n  display: flex;\n  gap: 2px;\n  padding: 2px;\n  border-radius: 8px;\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c2aaa67ff_tab {\n  flex: none;\n  border: 1px solid transparent;\n  border-radius: 6px;\n  padding: 3px 10px;\n  font: inherit;\n  font-size: 12px;\n  color: var(--dsw-alias-label-caption);\n  background: transparent;\n  cursor: pointer;\n}\n\n.c2aaa67ff_tab:hover {\n  color: var(--dsw-alias-label-primary);\n}\n\n.c2aaa67ff_tab[data-active='true'] {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);\n}\n\n/* \u9762\u677F\u9876\u90E8\u300C\u5F53\u524D\u5DE5\u4F5C\u533A\u300D\u4E0B\u62C9:\u6620\u5C04\u89C4\u5219\u53D8\u66F4\u540E\u7531 reloadKey \u9A71\u52A8\u91CD\u62C9\u3002 */\n.ceb3d3ed9_workspaceBar {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 14px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.c8001873f_workspaceLabel {\n  flex: none;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n  white-space: nowrap;\n}\n\n.ccba13c5c_workspaceSelect {\n  flex: 1;\n  min-width: 0;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 3px 6px;\n  font: inherit;\n  font-size: 12px;\n  color: inherit;\n  background: var(--dsw-alias-bg-base);\n}\n\n/* \u300C\u5F53\u524D\u5DE5\u4F5C\u533A\u300D\u624B\u52A8\u9009\u62E9\u540E\u7684\u4FDD\u5B58\u6309\u94AE:\u8349\u7A3F\u4E0E\u5DF2\u4FDD\u5B58\u503C\u4E0D\u4E00\u81F4\u65F6\u624D\u51FA\u73B0\u3002 */\n.cf9068aff_workspaceSave {\n  flex: none;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 3px 10px;\n  font: inherit;\n  font-size: 12px;\n  color: var(--dsw-alias-label-primary, #1f2328);\n  background: var(--dsw-alias-interactive-bg-hover);\n  cursor: pointer;\n  white-space: nowrap;\n}\n\n.cf9068aff_workspaceSave:hover {\n  border-color: var(--dsw-alias-border-l3);\n}\n\n.cb597abdb_workspaceNote {\n  flex: none;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n  white-space: nowrap;\n}\n\n.c3be1c85d_body {\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n  flex: 1;\n  overflow: hidden;\n}\n\n/* \u53F3\u4E0B\u89D2\u62D6\u62FD\u624B\u67C4:16px \u65B9\u5F62,\u60AC\u505C\u663E\u793A\u659C\u7EBF\u5149\u6807;overlay \u70B9\u51FB\u7A7F\u900F\u533A\u9700 pointer-events:auto\u3002 */\n.c9542591e_resizeHandle {\n  position: absolute;\n  right: 0;\n  bottom: 0;\n  width: 16px;\n  height: 16px;\n  cursor: nwse-resize;\n  pointer-events: auto;\n  border-bottom-right-radius: 12px;\n  background: linear-gradient(135deg, transparent 50%, var(--dsw-alias-border-l3, rgba(128,128,128,.4)) 50%);\n  opacity: 0;\n  transition: opacity 0.12s ease;\n}\n\n.c03bc34d0_panel:hover .c9542591e_resizeHandle,\n.c9542591e_resizeHandle:active {\n  opacity: 1;\n}\n";
var tagId = "@laizhixingxingdeli/dsh-coagenthub/CoAgentHubPanel.module.css";
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="' + tagId + '"]')) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@laizhixingxingdeli/dsh-coagenthub";
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
var CoAgentHubPanel_default = { "panel": "c03bc34d0_panel", "header": "c75a5b6d7_header", "title": "cc955129f_title", "tabs": "ca58e5d96_tabs", "tab": "c2aaa67ff_tab", "workspaceBar": "ceb3d3ed9_workspaceBar", "workspaceLabel": "c8001873f_workspaceLabel", "workspaceSelect": "ccba13c5c_workspaceSelect", "workspaceSave": "cf9068aff_workspaceSave", "workspaceNote": "cb597abdb_workspaceNote", "body": "c3be1c85d_body", "resizeHandle": "c9542591e_resizeHandle" };

// src/client-ui/CoAgentHubGroupList.tsx
var import_react = require("react");

// src/client-ui/CoAgentHubGroupList.module.css
var css2 = "/* CoAgentHub group-list content (browser half). Fills the \u7FA4\u5217\u8868 tab of the\n   CoAgentHub panel: a compact header over a scrolling list. The floating\n   chrome (position/border/shadow) lives on the panel container; this uses the\n   dsw theme aliases so dark mode and future theme changes apply. */\n\n.c2f96be9f_content {\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n  flex: 1;\n  overflow: hidden;\n}\n\n.c15a64b79_header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 8px 14px 6px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.c49941949_titleWrap {\n  display: flex;\n  align-items: baseline;\n  gap: 8px;\n  min-width: 0;\n}\n\n.c942eccad_title {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 600;\n  letter-spacing: 0.2px;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.cc7af2bf4_count {\n  flex: none;\n  padding: 1px 8px;\n  border-radius: 999px;\n  font-size: 11px;\n  font-weight: 500;\n  color: var(--dsw-alias-label-dimmed);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c40284cda_refresh {\n  flex: none;\n  border: 1px solid transparent;\n  border-radius: 6px;\n  padding: 3px 8px;\n  font: inherit;\n  font-size: 12px;\n  color: var(--dsw-alias-label-caption);\n  background: transparent;\n  cursor: pointer;\n}\n\n.c40284cda_refresh:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c95165155_body {\n  overflow-y: auto;\n  padding: 6px;\n  flex: 1;\n  min-height: 0;\n}\n\n.c1c495ea2_hint {\n  margin: 0;\n  padding: 2px 8px 8px;\n  color: var(--dsw-alias-label-dimmed);\n  font-size: 12px;\n}\n\n.cd9c9755b_list {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.c082ccf0b_row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  width: 100%;\n  padding: 7px 10px;\n  border: 1px solid transparent;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  transition: background 0.12s ease;\n}\n\n.c082ccf0b_row:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c082ccf0b_row[data-copied='true'] {\n  border-color: var(--dsw-alias-brand-primary);\n  background: var(--dsw-alias-interactive-bg-primary, rgba(76, 139, 245, 0.12));\n}\n\n.c4d74c9d1_rowMain {\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.c942eccad_title {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.c126061da_meta {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.ca47dfac6_dot {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  flex: none;\n}\n\n.ca47dfac6_dot[data-state='active'] {\n  background: #2da44e;\n}\n\n.ca47dfac6_dot[data-state='archived'] {\n  background: var(--dsw-alias-label-dimmed);\n}\n\n.c21fca710_statusText {\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n}\n\n.caf4fed6f_copied {\n  flex: none;\n  font-size: 11px;\n  color: var(--dsw-alias-brand-primary);\n}\n\n.c67968ba0_empty,\n.c4d212a29_error,\n.c55702099_loading {\n  margin: 0;\n  padding: 14px 10px;\n  color: var(--dsw-alias-label-dimmed);\n  text-align: center;\n}\n\n.c4d212a29_error {\n  color: var(--dsw-alias-label-error, #cf222e);\n  text-align: left;\n  font-size: 12px;\n}\n\n/* \u7FA4\u7ED1\u5B9A\u7684\u9879\u76EE\u8DEF\u5F84(Mac \u4FA7\u7EDD\u5BF9\u8DEF\u5F84;Win \u7528\u6237\u636E\u6B64\u5BF9\u5E94\u7F51\u7EDC\u6620\u5C04)\u3002 */\n.c797a7d58_path {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  max-width: 100%;\n  font-size: 10.5px;\n  color: var(--dsw-alias-label-dimmed);\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n}\n";
var tagId2 = "@laizhixingxingdeli/dsh-coagenthub/CoAgentHubGroupList.module.css";
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="' + tagId2 + '"]')) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@laizhixingxingdeli/dsh-coagenthub";
  tag.dataset.pluginCss = tagId2;
  tag.textContent = css2;
  document.head.appendChild(tag);
}
var CoAgentHubGroupList_default = { "content": "c2f96be9f_content", "header": "c15a64b79_header", "titleWrap": "c49941949_titleWrap", "title": "c942eccad_title", "count": "cc7af2bf4_count", "refresh": "c40284cda_refresh", "body": "c95165155_body", "hint": "c1c495ea2_hint", "list": "cd9c9755b_list", "row": "c082ccf0b_row", "rowMain": "c4d74c9d1_rowMain", "meta": "c126061da_meta", "dot": "ca47dfac6_dot", "statusText": "c21fca710_statusText", "copied": "caf4fed6f_copied", "empty": "c67968ba0_empty", "error": "c4d212a29_error", "loading": "c55702099_loading", "path": "c797a7d58_path" };

// src/client-ui/CoAgentHubGroupList.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var DEFAULT_API_BASE = "/coagenthub-api";
var GROUP_LIST_LIMIT = 50;
function statusLabel(status) {
  if (status === "active") return "\u8FDB\u884C\u4E2D";
  if (status === "archived") return "\u5DF2\u5F52\u6863";
  return status;
}
async function fetchGroups(apiBase) {
  const response = await fetch(`${apiBase}/groups?limit=${GROUP_LIST_LIMIT}`);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}${body !== "" ? `: ${body.slice(0, 200)}` : ""}`);
  }
  const data = await response.json();
  return data.items ?? [];
}
function CoAgentHubGroupList({ apiBase = DEFAULT_API_BASE }) {
  const [state, setState] = (0, import_react.useState)({ kind: "loading" });
  const [copiedId, setCopiedId] = (0, import_react.useState)(null);
  const [tick, setTick] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetchGroups(apiBase).then(
      (groups2) => {
        if (alive) setState({ kind: "ready", groups: groups2 });
      },
      (error) => {
        if (alive) setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    );
    return () => {
      alive = false;
    };
  }, [apiBase, tick]);
  const copyId = (id) => {
    const clipboard = navigator.clipboard;
    if (clipboard === void 0) return;
    void clipboard.writeText(id).then(() => setCopiedId(id)).catch(() => {
    });
  };
  const groups = state.kind === "ready" ? state.groups : [];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: CoAgentHubGroupList_default.content, "aria-label": "CoAgentHub \u7FA4\u5217\u8868", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: CoAgentHubGroupList_default.header, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: CoAgentHubGroupList_default.titleWrap, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: CoAgentHubGroupList_default.title, children: "CoAgentHub \u7FA4\u5217\u8868" }),
        state.kind === "ready" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: CoAgentHubGroupList_default.count, children: groups.length })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: CoAgentHubGroupList_default.refresh,
          onClick: () => setTick((v) => v + 1),
          title: "\u5237\u65B0",
          children: "\u5237\u65B0"
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: CoAgentHubGroupList_default.body, children: [
      state.kind === "loading" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: CoAgentHubGroupList_default.loading, children: "\u52A0\u8F7D\u4E2D\u2026" }),
      state.kind === "error" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: CoAgentHubGroupList_default.error, role: "alert", children: [
        "\u52A0\u8F7D\u5931\u8D25:",
        state.message
      ] }),
      state.kind === "ready" && groups.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: CoAgentHubGroupList_default.empty, children: "\u6682\u65E0\u7FA4\u7EC4" }),
      state.kind === "ready" && groups.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: CoAgentHubGroupList_default.list, children: groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: CoAgentHubGroupList_default.row,
          "data-copied": copiedId === group.id || void 0,
          onClick: () => copyId(group.id),
          title: `${group.id}\uFF08\u70B9\u51FB\u590D\u5236\uFF09`,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: CoAgentHubGroupList_default.rowMain, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: CoAgentHubGroupList_default.title, children: group.title }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: CoAgentHubGroupList_default.meta, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: CoAgentHubGroupList_default.dot, "data-state": group.status }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: CoAgentHubGroupList_default.statusText, children: statusLabel(group.status) })
              ] }),
              group.projectPath && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: CoAgentHubGroupList_default.path, title: group.projectPath, children: group.projectPath })
            ] }),
            copiedId === group.id && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: CoAgentHubGroupList_default.copied, children: "\u5DF2\u590D\u5236" })
          ]
        }
      ) }, group.id)) })
    ] })
  ] });
}

// src/client-ui/CoAgentHubTaskPanel.tsx
var import_react2 = require("react");

// src/client-ui/CoAgentHubTaskPanel.module.css
var css3 = "/* CoAgentHub task panel (browser half). Fills the \u4EFB\u52A1 tab of the CoAgentHub\n   panel: a group selector toolbar over a scrolling task list, with a detail\n   expansion area (\u4EFB\u52A1\u4E66 / attempt timeline / final report / terminal output)\n   that widens the panel. Uses the dsw theme aliases so dark mode and future\n   theme changes apply. */\n\n.c25be28dd_content {\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n  flex: 1;\n  overflow: hidden;\n}\n\n.c38ad2ff0_toolbar {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 8px 10px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.c8aa7dc30_groupSelect {\n  flex: 1;\n  min-width: 0;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 3px 6px;\n  font: inherit;\n  font-size: 12px;\n  color: inherit;\n  background: var(--dsw-alias-bg-base);\n}\n\n.cb15b26ee_refresh {\n  flex: none;\n  border: 1px solid transparent;\n  border-radius: 6px;\n  padding: 3px 8px;\n  font: inherit;\n  font-size: 12px;\n  color: var(--dsw-alias-label-caption);\n  background: transparent;\n  cursor: pointer;\n}\n\n.cb15b26ee_refresh:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.cb15b26ee_refresh:disabled {\n  opacity: 0.5;\n  cursor: default;\n}\n\n.c97a1d0d0_body {\n  overflow-y: auto;\n  padding: 6px;\n  flex: 1;\n  min-height: 0;\n}\n\n.c325fa5fe_list {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.c41a64928_row {\n  width: 100%;\n  padding: 7px 10px;\n  border: 1px solid transparent;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  transition: background 0.12s ease;\n}\n\n.c41a64928_row:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c41a64928_row[data-expanded='true'] {\n  border-color: var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c57eff48d_rowMain {\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n  min-width: 0;\n}\n\n.c64bff05d_rowTop {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n}\n\n.c585d03b3_badge {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  padding: 1px 7px;\n  border-radius: 999px;\n  font-size: 11px;\n  font-weight: 500;\n  line-height: 1.6;\n  white-space: nowrap;\n}\n\n.c585d03b3_badge[data-status='queued'] {\n  color: #b08800;\n  background: rgba(191, 135, 0, 0.14);\n}\n\n.c585d03b3_badge[data-status='running'] {\n  color: #0969da;\n  background: rgba(9, 105, 218, 0.14);\n}\n\n.c585d03b3_badge[data-status='done'] {\n  color: #1a7f37;\n  background: rgba(26, 127, 55, 0.12);\n}\n\n.c585d03b3_badge[data-status='failed'] {\n  color: #cf222e;\n  background: rgba(207, 34, 46, 0.12);\n}\n\n.c585d03b3_badge[data-status='cancelled'] {\n  color: var(--dsw-alias-label-dimmed);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c6a86eeb3_pulse {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  flex: none;\n  background: #0969da;\n  animation: coagenthubPulse 1.6s ease-in-out infinite;\n}\n\n@keyframes coagenthubPulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: 0.3; }\n}\n\n.c821b0a53_executor {\n  flex: none;\n  max-width: 40%;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 11px;\n  font-weight: 500;\n  color: var(--dsw-alias-label-caption);\n}\n\n.c9394b1b0_time {\n  flex: none;\n  margin-left: auto;\n  font-size: 11px;\n  color: var(--dsw-alias-label-dimmed);\n  white-space: nowrap;\n}\n\n.c0ccb5df0_summary {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* ---- Detail expansion area ---- */\n\n.cd2f5be34_detail {\n  margin: 2px 6px 6px;\n  padding: 8px 10px;\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-subtle, rgba(128, 128, 128, 0.06));\n  font-size: 12px;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n\n.c32a11281_detailHeader {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n\n.c32a11281_detailHeader .c821b0a53_executor {\n  max-width: none;\n}\n\n.c9d34d5eb_detailActions {\n  margin-left: auto;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.cbcdd602e_action {\n  flex: none;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 2px 8px;\n  font: inherit;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n  background: var(--dsw-alias-bg-base);\n  cursor: pointer;\n}\n\n.cbcdd602e_action:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.cbcdd602e_action[data-copied='true'] {\n  color: var(--dsw-alias-brand-primary);\n  border-color: var(--dsw-alias-brand-primary);\n}\n\n.c3767758d_section {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  min-width: 0;\n}\n\n.c356cee2a_sectionTitle {\n  margin: 0;\n  font-size: 11px;\n  font-weight: 600;\n  color: var(--dsw-alias-label-caption);\n}\n\n.c8c28c2c9_detailBrief {\n  margin: 0;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n\n.cc6f09930_textToggle {\n  align-self: flex-start;\n  border: none;\n  background: transparent;\n  padding: 0;\n  font: inherit;\n  font-size: 11px;\n  color: var(--dsw-alias-brand-primary);\n  cursor: pointer;\n}\n\n.c44e43809_timeline {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 5px;\n}\n\n.c6d0d20b3_timelineItem {\n  display: flex;\n  align-items: flex-start;\n  gap: 6px;\n  min-width: 0;\n}\n\n.c46e54dba_timelineNode {\n  flex: none;\n  width: 8px;\n  height: 8px;\n  margin-top: 4px;\n  border-radius: 50%;\n  background: var(--dsw-alias-label-dimmed);\n}\n\n.c46e54dba_timelineNode[data-ok='true'] {\n  background: #1a7f37;\n}\n\n.c46e54dba_timelineNode[data-ok='false'] {\n  background: #cf222e;\n}\n\n.c4c95bffe_timelineText {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: baseline;\n  gap: 2px 8px;\n  min-width: 0;\n}\n\n.ced518a99_timelineStep {\n  font-weight: 600;\n}\n\n.c22888cb2_timelineStatus[data-ok='true'] {\n  color: #1a7f37;\n}\n\n.c22888cb2_timelineStatus[data-ok='false'] {\n  color: #cf222e;\n}\n\n.c5d765a5c_timelineReason {\n  color: var(--dsw-alias-label-error, #cf222e);\n  word-break: break-word;\n}\n\n.ca5662aae_timelineHash {\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n}\n\n.c4bbc6f7d_report {\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n}\n\n.cebf616d5_reportRow {\n  display: flex;\n  align-items: baseline;\n  gap: 8px;\n  min-width: 0;\n}\n\n.cad52ccd2_reportLabel {\n  flex: none;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n}\n\n.c0dd9dd35_reportValue {\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n\n.c13e90298_outputToolbar {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.c3e421d53_search {\n  flex: 1;\n  min-width: 0;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 2px 6px;\n  font: inherit;\n  font-size: 11px;\n  color: inherit;\n  background: var(--dsw-alias-bg-base);\n}\n\n.c4035a835_toggle {\n  flex: none;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 2px 8px;\n  font: inherit;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n  background: var(--dsw-alias-bg-base);\n  cursor: pointer;\n}\n\n.c4035a835_toggle:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c4035a835_toggle[data-on='true'] {\n  color: var(--dsw-alias-brand-primary);\n  border-color: var(--dsw-alias-brand-primary);\n}\n\n/* Terminal-style process output (dark, monospace). */\n.cc166fc5d_terminal {\n  margin: 0;\n  padding: 8px;\n  border-radius: 6px;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 11px;\n  line-height: 1.5;\n  white-space: pre-wrap;\n  word-break: break-word;\n  max-height: 220px;\n  overflow: auto;\n  background: #101418;\n  color: #d7e0e8;\n}\n\n.c928d5d64_termLine {\n  min-height: 1.5em;\n}\n\n.c8fe93f07_hit {\n  background: #b08800;\n  color: #fff;\n  border-radius: 2px;\n  padding: 0 1px;\n}\n\n.ca6a57656_detailError {\n  margin: 0;\n  padding: 6px 8px;\n  border-radius: 6px;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 11px;\n  line-height: 1.5;\n  white-space: pre-wrap;\n  word-break: break-word;\n  max-height: 160px;\n  overflow: auto;\n  background: rgba(207, 34, 46, 0.08);\n  color: var(--dsw-alias-label-error, #cf222e);\n}\n\n.c52c64ffd_empty,\n.cb08d66df_error,\n.ca91ac836_loading {\n  margin: 0;\n  padding: 14px 10px;\n  color: var(--dsw-alias-label-dimmed);\n  text-align: center;\n}\n\n.cb08d66df_error {\n  color: var(--dsw-alias-label-error, #cf222e);\n  text-align: left;\n  font-size: 12px;\n}\n";
var tagId3 = "@laizhixingxingdeli/dsh-coagenthub/CoAgentHubTaskPanel.module.css";
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="' + tagId3 + '"]')) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@laizhixingxingdeli/dsh-coagenthub";
  tag.dataset.pluginCss = tagId3;
  tag.textContent = css3;
  document.head.appendChild(tag);
}
var CoAgentHubTaskPanel_default = { "content": "c25be28dd_content", "toolbar": "c38ad2ff0_toolbar", "groupSelect": "c8aa7dc30_groupSelect", "refresh": "cb15b26ee_refresh", "body": "c97a1d0d0_body", "list": "c325fa5fe_list", "row": "c41a64928_row", "rowMain": "c57eff48d_rowMain", "rowTop": "c64bff05d_rowTop", "badge": "c585d03b3_badge", "pulse": "c6a86eeb3_pulse", "executor": "c821b0a53_executor", "time": "c9394b1b0_time", "summary": "c0ccb5df0_summary", "detail": "cd2f5be34_detail", "detailHeader": "c32a11281_detailHeader", "detailActions": "c9d34d5eb_detailActions", "action": "cbcdd602e_action", "section": "c3767758d_section", "sectionTitle": "c356cee2a_sectionTitle", "detailBrief": "c8c28c2c9_detailBrief", "textToggle": "cc6f09930_textToggle", "timeline": "c44e43809_timeline", "timelineItem": "c6d0d20b3_timelineItem", "timelineNode": "c46e54dba_timelineNode", "timelineText": "c4c95bffe_timelineText", "timelineStep": "ced518a99_timelineStep", "timelineStatus": "c22888cb2_timelineStatus", "timelineReason": "c5d765a5c_timelineReason", "timelineHash": "ca5662aae_timelineHash", "report": "c4bbc6f7d_report", "reportRow": "cebf616d5_reportRow", "reportLabel": "cad52ccd2_reportLabel", "reportValue": "c0dd9dd35_reportValue", "outputToolbar": "c13e90298_outputToolbar", "search": "c3e421d53_search", "toggle": "c4035a835_toggle", "terminal": "cc166fc5d_terminal", "termLine": "c928d5d64_termLine", "hit": "c8fe93f07_hit", "detailError": "ca6a57656_detailError", "empty": "c52c64ffd_empty", "error": "cb08d66df_error", "loading": "ca91ac836_loading" };

// src/client-ui/CoAgentHubTaskPanel.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var TASK_REFRESH_MS = 15e3;
var SUMMARY_LIMIT = 60;
var BRIEF_LIMIT = 400;
var OUTPUT_LIMIT = 8e3;
function normalizeTaskView(raw) {
  return {
    id: raw.id,
    status: raw.status,
    executorKey: raw.executorKey ?? "",
    executorLabel: raw.executorLabel ?? "",
    executorParticipantId: raw.executorParticipantId ?? "",
    brief: raw.brief ?? "",
    diffSummary: raw.diffSummary ?? null,
    outputTail: raw.outputTail ?? null,
    attempts: (raw.attempts ?? []).map((attempt) => ({
      n: attempt.n ?? 0,
      startedAt: attempt.startedAt ?? "",
      endedAt: attempt.endedAt ?? null,
      status: attempt.status ?? "",
      error: attempt.error ?? null,
      summary: attempt.summary ?? null,
      hash: attempt.hash ?? null
    })),
    createdAt: raw.createdAt ?? "",
    updatedAt: raw.updatedAt ?? raw.createdAt ?? "",
    retryCount: raw.retryCount ?? 0
  };
}
function statusLabel2(status) {
  if (status === "queued") return "\u6392\u961F\u4E2D";
  if (status === "running") return "\u6267\u884C\u4E2D";
  if (status === "done") return "\u5DF2\u5B8C\u6210";
  if (status === "failed") return "\u5931\u8D25";
  if (status === "cancelled") return "\u5DF2\u53D6\u6D88";
  return status;
}
function executorLabel(task, nameById) {
  if (task.executorLabel !== void 0 && task.executorLabel !== "") return task.executorLabel;
  if (nameById !== void 0 && task.executorParticipantId !== "") {
    const name = nameById.get(task.executorParticipantId);
    if (name !== void 0 && name !== "") return name;
  }
  return task.executorKey;
}
function taskSummary(task) {
  const raw = task.diffSummary?.summary || task.brief || "";
  const text = raw.trim();
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT)}\u2026` : text;
}
function briefText(task) {
  const text = (task.brief ?? "").trim();
  return text.length > BRIEF_LIMIT ? `${text.slice(0, BRIEF_LIMIT)}\u2026` : text;
}
function isBriefTruncated(task) {
  return (task.brief ?? "").trim().length > BRIEF_LIMIT;
}
function capOutput(text) {
  const value = (text ?? "").trim();
  return value.length > OUTPUT_LIMIT ? `${value.slice(0, OUTPUT_LIMIT)}\u2026` : value;
}
function formatUpdatedAt(iso, now = Date.now()) {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;
  const diffMs = Math.max(0, now - time);
  if (diffMs < 6e4) return "\u521A\u521A";
  if (diffMs < 36e5) return `${Math.floor(diffMs / 6e4)} \u5206\u949F\u524D`;
  if (diffMs < 864e5) return `${Math.floor(diffMs / 36e5)} \u5C0F\u65F6\u524D`;
  const date = new Date(time);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
async function fetchTasks(apiBase, groupId) {
  const response = await fetch(`${apiBase}/groups/${encodeURIComponent(groupId)}/tasks?includeOutput=1`);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}${body !== "" ? `: ${body.slice(0, 200)}` : ""}`);
  }
  const data = await response.json();
  if (Array.isArray(data)) return data.map(normalizeTaskView);
  if (data !== null && typeof data === "object" && Array.isArray(data.items)) return data.items.map(normalizeTaskView);
  return [];
}
async function fetchParticipants(apiBase) {
  const response = await fetch(`${apiBase}/participants`);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}${body !== "" ? `: ${body.slice(0, 200)}` : ""}`);
  }
  const data = await response.json();
  const list = Array.isArray(data) ? data : data !== null && typeof data === "object" && Array.isArray(data.items) ? data.items : [];
  return new Map(list.map((participant) => [participant.id, participant.name]));
}
function rawOutputUrl(apiBase, taskId) {
  return `${apiBase}/raw/${encodeURIComponent(taskId)}`;
}
function parseFinalReport(summary, hash) {
  const report = { \u63D0\u4EA4: null, \u6D4B\u8BD5: null, \u6C47\u62A5: null, \u9057\u7559: null };
  if (hash !== null && hash !== void 0 && hash !== "") report.\u63D0\u4EA4 = hash.slice(0, 7);
  const text = (summary ?? "").trim();
  if (text === "") return report;
  let matched = false;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(提交|测试|汇报|遗留)\s*[:：]\s*(.*)$/);
    if (match === null) continue;
    const value = match[2].trim();
    switch (match[1]) {
      case "\u63D0\u4EA4":
        report.\u63D0\u4EA4 = value;
        break;
      case "\u6D4B\u8BD5":
        report.\u6D4B\u8BD5 = value;
        break;
      case "\u6C47\u62A5":
        report.\u6C47\u62A5 = value;
        break;
      default:
        report.\u9057\u7559 = value;
        break;
    }
    matched = true;
  }
  if (!matched) report.\u6C47\u62A5 = text;
  return report;
}
function highlightTerm(line, term, keyPrefix) {
  if (term === "") return line;
  const parts = line.split(term);
  const nodes = [];
  parts.forEach((part, index) => {
    if (part !== "") nodes.push(/* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: part }, `${keyPrefix}-t${index}`));
    if (index < parts.length - 1) nodes.push(/* @__PURE__ */ (0, import_jsx_runtime2.jsx)("mark", { className: CoAgentHubTaskPanel_default.hit, children: term }, `${keyPrefix}-m${index}`));
  });
  return nodes;
}
function CoAgentHubTaskPanel({ apiBase = DEFAULT_API_BASE, onDetailChange, defaultGroupId }) {
  const [groups, setGroups] = (0, import_react2.useState)([]);
  const [groupsError, setGroupsError] = (0, import_react2.useState)(null);
  const [groupId, setGroupId] = (0, import_react2.useState)("");
  const [participantNames, setParticipantNames] = (0, import_react2.useState)(/* @__PURE__ */ new Map());
  const participantNamesRef = (0, import_react2.useRef)(participantNames);
  const [state, setState] = (0, import_react2.useState)({ kind: "idle" });
  const [expandedId, setExpandedId] = (0, import_react2.useState)(null);
  const [copiedId, setCopiedId] = (0, import_react2.useState)(null);
  const [briefExpanded, setBriefExpanded] = (0, import_react2.useState)(false);
  const [followOutput, setFollowOutput] = (0, import_react2.useState)(true);
  const [searchTerm, setSearchTerm] = (0, import_react2.useState)("");
  const [tick, setTick] = (0, import_react2.useState)(0);
  const outputRef = (0, import_react2.useRef)(null);
  const stateRef = (0, import_react2.useRef)({ kind: "idle" });
  const loadedGroupRef = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    let alive = true;
    fetchGroups(apiBase).then(
      (items) => {
        if (alive) {
          setGroups(items);
          setGroupsError(null);
        }
      },
      (error) => {
        if (alive) setGroupsError(error instanceof Error ? error.message : String(error));
      }
    );
    return () => {
      alive = false;
    };
  }, [apiBase]);
  (0, import_react2.useEffect)(() => {
    let alive = true;
    fetchParticipants(apiBase).then(
      (names) => {
        if (alive) {
          participantNamesRef.current = names;
          setParticipantNames(names);
        }
      },
      (error) => {
        if (alive) console.warn(`[CoAgentHubTaskPanel] \u53C2\u4E0E\u8005\u5217\u8868\u52A0\u8F7D\u5931\u8D25,\u6267\u884C\u8005\u56DE\u9000\u663E\u793A executorKey:${error instanceof Error ? error.message : String(error)}`);
      }
    );
    return () => {
      alive = false;
    };
  }, [apiBase]);
  (0, import_react2.useEffect)(() => {
    if (defaultGroupId !== void 0 && defaultGroupId !== "" && defaultGroupId !== groupId) {
      setGroupId(defaultGroupId);
    }
  }, [defaultGroupId]);
  (0, import_react2.useEffect)(() => {
    if (groupId === "") {
      setState({ kind: "idle" });
      return;
    }
    let alive = true;
    setState((prev) => prev.kind === "ready" && loadedGroupRef.current === groupId ? prev : { kind: "loading" });
    fetchTasks(apiBase, groupId).then(
      (tasks2) => {
        if (alive) {
          loadedGroupRef.current = groupId;
          setState({ kind: "ready", tasks: tasks2 });
        }
      },
      (error) => {
        if (!alive) return;
        const message = error instanceof Error ? error.message : String(error);
        if (stateRef.current.kind === "ready" && loadedGroupRef.current === groupId) {
          console.warn(`[CoAgentHubTaskPanel] \u5237\u65B0\u4EFB\u52A1\u5931\u8D25,\u4FDD\u7559\u65E7\u5217\u8868:${message}`);
          return;
        }
        setState({ kind: "error", message });
      }
    );
    return () => {
      alive = false;
    };
  }, [apiBase, groupId, tick]);
  (0, import_react2.useEffect)(() => {
    stateRef.current = state;
  }, [state]);
  (0, import_react2.useEffect)(() => {
    if (groupId === "") return;
    const timer = window.setInterval(() => setTick((v) => v + 1), TASK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [groupId]);
  (0, import_react2.useEffect)(() => {
    onDetailChange?.(expandedId !== null);
  }, [expandedId, onDetailChange]);
  (0, import_react2.useEffect)(() => {
    if (followOutput && outputRef.current !== null) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [followOutput, state, searchTerm]);
  const copyId = (id) => {
    const clipboard = navigator.clipboard;
    if (clipboard === void 0) return;
    void clipboard.writeText(id).then(() => setCopiedId(id)).catch(() => {
    });
  };
  const openFullOutput = (taskId) => {
    window.open(rawOutputUrl(apiBase, taskId), "_blank", "noopener");
  };
  const toggleRow = (id) => {
    setExpandedId((prev) => prev === id ? null : id);
    setBriefExpanded(false);
    setSearchTerm("");
  };
  const tasks = state.kind === "ready" ? state.tasks : [];
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: CoAgentHubTaskPanel_default.content, "aria-label": "CoAgentHub \u4EFB\u52A1\u9762\u677F", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.toolbar, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
        "select",
        {
          className: CoAgentHubTaskPanel_default.groupSelect,
          value: groupId,
          onChange: (event) => setGroupId(event.target.value),
          "aria-label": "\u9009\u62E9\u7FA4\u7EC4",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "\u8BF7\u9009\u62E9\u7FA4\u7EC4" }),
            groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: group.id, children: group.title }, group.id))
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "button",
        {
          type: "button",
          className: CoAgentHubTaskPanel_default.refresh,
          onClick: () => setTick((v) => v + 1),
          disabled: groupId === "",
          title: "\u5237\u65B0",
          children: "\u5237\u65B0"
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.body, children: [
      groupsError !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: CoAgentHubTaskPanel_default.error, role: "alert", children: [
        "\u7FA4\u5217\u8868\u52A0\u8F7D\u5931\u8D25:",
        groupsError
      ] }),
      state.kind === "idle" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: CoAgentHubTaskPanel_default.empty, children: "\u8BF7\u9009\u62E9\u7FA4\u7EC4\u67E5\u770B\u4EFB\u52A1" }),
      state.kind === "loading" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: CoAgentHubTaskPanel_default.loading, children: "\u52A0\u8F7D\u4E2D\u2026" }),
      state.kind === "error" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: CoAgentHubTaskPanel_default.error, role: "alert", children: [
        "\u4EFB\u52A1\u52A0\u8F7D\u5931\u8D25:",
        state.message
      ] }),
      state.kind === "ready" && tasks.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: CoAgentHubTaskPanel_default.empty, children: "\u6682\u65E0\u4EFB\u52A1" }),
      state.kind === "ready" && tasks.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: CoAgentHubTaskPanel_default.list, children: tasks.map((task) => {
        const expanded = expandedId === task.id;
        const attempts = task.attempts ?? [];
        const diffError = task.diffSummary?.error ?? null;
        const diffOutput = task.diffSummary?.outputTail ?? task.outputTail ?? null;
        const fullBrief = (task.brief ?? "").trim();
        const report = parseFinalReport(task.diffSummary?.summary, task.diffSummary?.hash);
        const hasReport = report.\u63D0\u4EA4 !== null || report.\u6D4B\u8BD5 !== null || report.\u6C47\u62A5 !== null || report.\u9057\u7559 !== null;
        const term = searchTerm.trim();
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              className: CoAgentHubTaskPanel_default.row,
              "data-expanded": expanded || void 0,
              onClick: () => toggleRow(task.id),
              "aria-expanded": expanded,
              children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: CoAgentHubTaskPanel_default.rowMain, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: CoAgentHubTaskPanel_default.rowTop, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: CoAgentHubTaskPanel_default.badge, "data-status": task.status, children: [
                    task.status === "running" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.pulse }),
                    statusLabel2(task.status)
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.executor, children: executorLabel(task, participantNames) }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.time, children: formatUpdatedAt(task.updatedAt) })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.summary, children: taskSummary(task) })
              ] })
            }
          ),
          expanded && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.detail, "data-testid": "task-detail", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.detailHeader, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.executor, children: executorLabel(task, participantNames) }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.detailActions, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "button",
                  {
                    type: "button",
                    className: CoAgentHubTaskPanel_default.action,
                    "data-copied": copiedId === task.id || void 0,
                    onClick: () => copyId(task.id),
                    title: `${task.id}\uFF08\u590D\u5236\uFF09`,
                    children: copiedId === task.id ? "\u5DF2\u590D\u5236" : "\u590D\u5236 id"
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "button",
                  {
                    type: "button",
                    className: CoAgentHubTaskPanel_default.action,
                    onClick: () => openFullOutput(task.id),
                    title: "\u65B0\u6807\u7B7E\u9875\u6253\u5F00\u5B8C\u6574\u8F93\u51FA",
                    children: "\u6253\u5F00\u5B8C\u6574\u8F93\u51FA"
                  }
                )
              ] })
            ] }),
            fullBrief !== "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.section, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h4", { className: CoAgentHubTaskPanel_default.sectionTitle, children: "\u4EFB\u52A1\u4E66" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: CoAgentHubTaskPanel_default.detailBrief, children: briefExpanded ? fullBrief : briefText(task) }),
              isBriefTruncated(task) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                "button",
                {
                  type: "button",
                  className: CoAgentHubTaskPanel_default.textToggle,
                  onClick: () => setBriefExpanded((v) => !v),
                  children: briefExpanded ? "\u6536\u8D77" : "\u5C55\u5F00\u5168\u6587"
                }
              )
            ] }),
            attempts.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.section, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h4", { className: CoAgentHubTaskPanel_default.sectionTitle, children: "\u6267\u884C\u5386\u53F2" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ol", { className: CoAgentHubTaskPanel_default.timeline, children: attempts.map((attempt) => {
                const ok = attempt.status === "done";
                return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: CoAgentHubTaskPanel_default.timelineItem, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.timelineNode, "data-ok": ok || void 0 }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: CoAgentHubTaskPanel_default.timelineText, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: CoAgentHubTaskPanel_default.timelineStep, children: [
                      "\u7B2C ",
                      attempt.n,
                      " \u6B21"
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.timelineStatus, "data-ok": ok || void 0, children: statusLabel2(attempt.status) }),
                    attempt.error != null && attempt.error !== "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.timelineReason, children: attempt.error }),
                    attempt.hash != null && attempt.hash !== "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.timelineHash, children: attempt.hash.slice(0, 7) })
                  ] })
                ] }, attempt.n);
              }) })
            ] }),
            hasReport && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.section, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h4", { className: CoAgentHubTaskPanel_default.sectionTitle, children: "\u6700\u7EC8\u6C47\u62A5" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.report, children: [
                report.\u63D0\u4EA4 !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.reportRow, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.reportLabel, children: "\u63D0\u4EA4" }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.reportValue, children: report.\u63D0\u4EA4 })
                ] }),
                report.\u6D4B\u8BD5 !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.reportRow, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.reportLabel, children: "\u6D4B\u8BD5" }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.reportValue, children: report.\u6D4B\u8BD5 })
                ] }),
                report.\u6C47\u62A5 !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.reportRow, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.reportLabel, children: "\u6C47\u62A5" }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.reportValue, children: report.\u6C47\u62A5 })
                ] }),
                report.\u9057\u7559 !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.reportRow, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.reportLabel, children: "\u9057\u7559" }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CoAgentHubTaskPanel_default.reportValue, children: report.\u9057\u7559 })
                ] })
              ] })
            ] }),
            diffError !== "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.section, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h4", { className: CoAgentHubTaskPanel_default.sectionTitle, children: "\u5931\u8D25\u539F\u56E0" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { className: CoAgentHubTaskPanel_default.detailError, children: capOutput(diffError) })
            ] }),
            diffOutput !== "" && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.section, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CoAgentHubTaskPanel_default.outputToolbar, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "input",
                  {
                    className: CoAgentHubTaskPanel_default.search,
                    value: searchTerm,
                    onChange: (event) => setSearchTerm(event.target.value),
                    placeholder: "\u641C\u7D22\u8F93\u51FA",
                    "aria-label": "\u641C\u7D22\u8F93\u51FA"
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "button",
                  {
                    type: "button",
                    className: CoAgentHubTaskPanel_default.toggle,
                    "data-on": followOutput || void 0,
                    "aria-pressed": followOutput,
                    onClick: () => setFollowOutput((v) => !v),
                    children: "\u8DDF\u968F\u6EDA\u52A8"
                  }
                )
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { className: CoAgentHubTaskPanel_default.terminal, ref: outputRef, "aria-label": "\u8FC7\u7A0B\u8F93\u51FA", children: term === "" ? capOutput(diffOutput) : capOutput(diffOutput).split("\n").filter((line) => line.includes(term)).map(
                (line, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: CoAgentHubTaskPanel_default.termLine, children: highlightTerm(line, term, `l${index}`) }, index)
              ) })
            ] })
          ] })
        ] }, task.id);
      }) })
    ] })
  ] });
}

// src/client-ui/CoAgentHubExecutorsPanel.tsx
var import_react3 = require("react");

// src/client-ui/CoAgentHubExecutorsPanel.module.css
var css4 = "/* CoAgentHub executors panel (browser half). Fills the \u6267\u884C\u5668 tab of the\n   CoAgentHub panel: a header over the executor list, a collapsible create\n   form, and per-row actions (copy key / delete). Uses the dsw theme aliases\n   so dark mode and future theme changes apply. */\n\n.cb2525d43_content {\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n  flex: 1;\n  overflow: hidden;\n}\n\n.c09c525ee_header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 8px 14px 6px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.cedcaa498_titleWrap {\n  display: flex;\n  align-items: baseline;\n  gap: 8px;\n  min-width: 0;\n}\n\n.ced46ade1_title {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 600;\n  letter-spacing: 0.2px;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.ce40c3a28_count {\n  flex: none;\n  padding: 1px 8px;\n  border-radius: 999px;\n  font-size: 11px;\n  font-weight: 500;\n  color: var(--dsw-alias-label-dimmed);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.cef0ddbd4_refresh {\n  flex: none;\n  border: 1px solid transparent;\n  border-radius: 6px;\n  padding: 3px 8px;\n  font: inherit;\n  font-size: 12px;\n  color: var(--dsw-alias-label-caption);\n  background: transparent;\n  cursor: pointer;\n}\n\n.cef0ddbd4_refresh:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.cabd76499_toolbar {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 6px 10px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.c579b39a6_addToggle {\n  flex: none;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 3px 10px;\n  font: inherit;\n  font-size: 12px;\n  color: var(--dsw-alias-label-caption);\n  background: var(--dsw-alias-bg-base);\n  cursor: pointer;\n}\n\n.c579b39a6_addToggle:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c579b39a6_addToggle[data-open='true'] {\n  color: var(--dsw-alias-brand-primary);\n  border-color: var(--dsw-alias-brand-primary);\n}\n\n.c04e3d126_form {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  margin: 6px;\n  padding: 8px 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-subtle, rgba(128, 128, 128, 0.06));\n}\n\n.c9db4cb0a_field {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.c7575bb58_fieldLabel {\n  flex: none;\n  width: 72px;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n}\n\n.cbdac6abc_input {\n  flex: 1;\n  min-width: 0;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 3px 6px;\n  font: inherit;\n  font-size: 12px;\n  color: inherit;\n  background: var(--dsw-alias-bg-base);\n}\n\n.cbdac6abc_input::placeholder {\n  color: var(--dsw-alias-label-dimmed);\n}\n\n.ca80b86fb_submit {\n  align-self: flex-end;\n  flex: none;\n  border: 1px solid transparent;\n  border-radius: 6px;\n  padding: 3px 14px;\n  font: inherit;\n  font-size: 12px;\n  color: #fff;\n  background: var(--dsw-alias-brand-primary, #4c8bf5);\n  cursor: pointer;\n}\n\n.ca80b86fb_submit:hover {\n  filter: brightness(1.06);\n}\n\n.ca80b86fb_submit:disabled {\n  opacity: 0.6;\n  cursor: default;\n}\n\n.ca773e37f_body {\n  overflow-y: auto;\n  padding: 6px;\n  flex: 1;\n  min-height: 0;\n}\n\n.cf6d91b17_list {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.cdbb71b62_row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  width: 100%;\n  padding: 7px 10px;\n  border: 1px solid transparent;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n}\n\n.cdbb71b62_row:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.cdbb71b62_row[data-builtin='true'] {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.cf8950991_rowMain {\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.c7a8be099_rowTop {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n}\n\n.cdfcf3cec_key {\n  font-weight: 600;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.c1d200da5_builtin {\n  flex: none;\n  padding: 0 6px;\n  border-radius: 999px;\n  font-size: 10px;\n  font-weight: 600;\n  line-height: 1.6;\n  color: #1a7f37;\n  background: rgba(26, 127, 55, 0.12);\n}\n\n.cae1e7ed9_model {\n  flex: none;\n  font-size: 11px;\n  color: var(--dsw-alias-label-dimmed);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.cf193ecbc_meta {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n}\n\n.cebbcd3a2_agentName {\n  flex: none;\n  font-size: 11px;\n  font-weight: 500;\n  color: var(--dsw-alias-label-caption);\n}\n\n.cb3257e88_bin {\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 11px;\n  color: var(--dsw-alias-label-dimmed);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.c5de69ee9_args {\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 11px;\n  color: var(--dsw-alias-label-dimmed);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.ce6691753_rowActions {\n  flex: none;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.c9d523b6c_copy,\n.c82f40f43_delete {\n  flex: none;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 2px 8px;\n  font: inherit;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n  background: var(--dsw-alias-bg-base);\n  cursor: pointer;\n}\n\n.c9d523b6c_copy:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c9d523b6c_copy[data-copied='true'] {\n  color: var(--dsw-alias-brand-primary);\n  border-color: var(--dsw-alias-brand-primary);\n}\n\n.c82f40f43_delete {\n  color: var(--dsw-alias-label-error, #cf222e);\n  border-color: rgba(207, 34, 46, 0.35);\n}\n\n.c82f40f43_delete:hover {\n  background: rgba(207, 34, 46, 0.1);\n}\n\n.c69db9040_empty,\n.c30d6a827_error,\n.ccdb530e9_loading {\n  margin: 0;\n  padding: 14px 10px;\n  color: var(--dsw-alias-label-dimmed);\n  text-align: center;\n}\n\n.c30d6a827_error {\n  color: var(--dsw-alias-label-error, #cf222e);\n  text-align: left;\n  font-size: 12px;\n}\n";
var tagId4 = "@laizhixingxingdeli/dsh-coagenthub/CoAgentHubExecutorsPanel.module.css";
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="' + tagId4 + '"]')) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@laizhixingxingdeli/dsh-coagenthub";
  tag.dataset.pluginCss = tagId4;
  tag.textContent = css4;
  document.head.appendChild(tag);
}
var CoAgentHubExecutorsPanel_default = { "content": "cb2525d43_content", "header": "c09c525ee_header", "titleWrap": "cedcaa498_titleWrap", "title": "ced46ade1_title", "count": "ce40c3a28_count", "refresh": "cef0ddbd4_refresh", "toolbar": "cabd76499_toolbar", "addToggle": "c579b39a6_addToggle", "form": "c04e3d126_form", "field": "c9db4cb0a_field", "fieldLabel": "c7575bb58_fieldLabel", "input": "cbdac6abc_input", "submit": "ca80b86fb_submit", "body": "ca773e37f_body", "list": "cf6d91b17_list", "row": "cdbb71b62_row", "rowMain": "cf8950991_rowMain", "rowTop": "c7a8be099_rowTop", "key": "cdfcf3cec_key", "builtin": "c1d200da5_builtin", "model": "cae1e7ed9_model", "meta": "cf193ecbc_meta", "agentName": "cebbcd3a2_agentName", "bin": "cb3257e88_bin", "args": "c5de69ee9_args", "rowActions": "ce6691753_rowActions", "copy": "c9d523b6c_copy", "delete": "c82f40f43_delete", "empty": "c69db9040_empty", "error": "c30d6a827_error", "loading": "ccdb530e9_loading" };

// src/client-ui/CoAgentHubExecutorsPanel.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var ARGS_LIMIT = 60;
function argsPreview(args) {
  const text = (args ?? []).join(" ");
  return text.length > ARGS_LIMIT ? `${text.slice(0, ARGS_LIMIT)}\u2026` : text;
}
async function fetchExecutors(apiBase) {
  const response = await fetch(`${apiBase}/executors`);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}${body !== "" ? `: ${body.slice(0, 200)}` : ""}`);
  }
  const data = await response.json();
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === "object" && Array.isArray(data.items)) return data.items;
  return [];
}
async function createExecutor(apiBase, input) {
  const response = await fetch(`${apiBase}/executors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}${body !== "" ? `: ${body.slice(0, 200)}` : ""}`);
  }
}
async function deleteExecutor(apiBase, key) {
  const response = await fetch(`${apiBase}/executors/${encodeURIComponent(key)}`, { method: "DELETE" });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}${body !== "" ? `: ${body.slice(0, 200)}` : ""}`);
  }
}
function CoAgentHubExecutorsPanel({ apiBase = DEFAULT_API_BASE }) {
  const [state, setState] = (0, import_react3.useState)({ kind: "loading" });
  const [copiedKey, setCopiedKey] = (0, import_react3.useState)(null);
  const [actionError, setActionError] = (0, import_react3.useState)(null);
  const [tick, setTick] = (0, import_react3.useState)(0);
  const [formOpen, setFormOpen] = (0, import_react3.useState)(false);
  const [formKey, setFormKey] = (0, import_react3.useState)("");
  const [formAgentName, setFormAgentName] = (0, import_react3.useState)("");
  const [formBin, setFormBin] = (0, import_react3.useState)("");
  const [formKind, setFormKind] = (0, import_react3.useState)("cli");
  const [formArgs, setFormArgs] = (0, import_react3.useState)("");
  const [formModel, setFormModel] = (0, import_react3.useState)("");
  const [submitting, setSubmitting] = (0, import_react3.useState)(false);
  const [submitError, setSubmitError] = (0, import_react3.useState)(null);
  (0, import_react3.useEffect)(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetchExecutors(apiBase).then(
      (executors2) => {
        if (alive) setState({ kind: "ready", executors: executors2 });
      },
      (error) => {
        if (alive) setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    );
    return () => {
      alive = false;
    };
  }, [apiBase, tick]);
  const copyKey = (key) => {
    const clipboard = navigator.clipboard;
    if (clipboard === void 0) return;
    void clipboard.writeText(key).then(() => setCopiedKey(key)).catch(() => {
    });
  };
  const handleDelete = (executor) => {
    if (!window.confirm(`\u5220\u9664\u6267\u884C\u5668 ${executor.key}?`)) return;
    deleteExecutor(apiBase, executor.key).then(
      () => {
        setActionError(null);
        setTick((v) => v + 1);
      },
      (error) => {
        setActionError(`\u5220\u9664\u5931\u8D25:${error instanceof Error ? error.message : String(error)}`);
      }
    );
  };
  const handleSubmit = (event) => {
    event.preventDefault();
    const key = formKey.trim();
    if (key === "") {
      setSubmitError("key \u5FC5\u586B");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const input = { key, kind: formKind };
    if (formAgentName.trim() !== "") input.agentName = formAgentName.trim();
    if (formBin.trim() !== "") input.bin = formBin.trim();
    if (formModel.trim() !== "") input.model = formModel.trim();
    input.args = formArgs.trim() === "" ? [] : formArgs.trim().split(/\s+/);
    createExecutor(apiBase, input).then(
      () => {
        setSubmitting(false);
        setFormKey("");
        setFormAgentName("");
        setFormBin("");
        setFormArgs("");
        setFormModel("");
        setTick((v) => v + 1);
      },
      (error) => {
        setSubmitting(false);
        setSubmitError(error instanceof Error ? error.message : String(error));
      }
    );
  };
  const executors = state.kind === "ready" ? state.executors : [];
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: CoAgentHubExecutorsPanel_default.content, "aria-label": "CoAgentHub \u6267\u884C\u5668", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: CoAgentHubExecutorsPanel_default.header, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: CoAgentHubExecutorsPanel_default.titleWrap, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { className: CoAgentHubExecutorsPanel_default.title, children: "CoAgentHub \u6267\u884C\u5668" }),
        state.kind === "ready" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: CoAgentHubExecutorsPanel_default.count, children: executors.length })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "button",
        {
          type: "button",
          className: CoAgentHubExecutorsPanel_default.refresh,
          onClick: () => setTick((v) => v + 1),
          title: "\u5237\u65B0",
          children: "\u5237\u65B0"
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: CoAgentHubExecutorsPanel_default.toolbar, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "button",
      {
        type: "button",
        className: CoAgentHubExecutorsPanel_default.addToggle,
        "data-open": formOpen || void 0,
        onClick: () => setFormOpen((v) => !v),
        "aria-expanded": formOpen,
        children: formOpen ? "\u6536\u8D77\u65B0\u589E\u8868\u5355" : "\u65B0\u589E\u6267\u884C\u5668"
      }
    ) }),
    formOpen && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("form", { className: CoAgentHubExecutorsPanel_default.form, onSubmit: handleSubmit, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: CoAgentHubExecutorsPanel_default.field, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: CoAgentHubExecutorsPanel_default.fieldLabel, children: "key *" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "input",
          {
            className: CoAgentHubExecutorsPanel_default.input,
            value: formKey,
            onChange: (event) => setFormKey(event.target.value),
            placeholder: "\u6267\u884C\u5668\u552F\u4E00 key",
            "aria-label": "\u65B0\u589E key"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: CoAgentHubExecutorsPanel_default.field, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: CoAgentHubExecutorsPanel_default.fieldLabel, children: "agentName" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "input",
          {
            className: CoAgentHubExecutorsPanel_default.input,
            value: formAgentName,
            onChange: (event) => setFormAgentName(event.target.value),
            placeholder: "\u5C55\u793A\u540D",
            "aria-label": "\u65B0\u589E agentName"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: CoAgentHubExecutorsPanel_default.field, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: CoAgentHubExecutorsPanel_default.fieldLabel, children: "bin" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "input",
          {
            className: CoAgentHubExecutorsPanel_default.input,
            value: formBin,
            onChange: (event) => setFormBin(event.target.value),
            placeholder: "\u53EF\u6267\u884C\u6587\u4EF6",
            "aria-label": "\u65B0\u589E bin"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: CoAgentHubExecutorsPanel_default.field, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: CoAgentHubExecutorsPanel_default.fieldLabel, children: "kind" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "select",
          {
            className: CoAgentHubExecutorsPanel_default.input,
            value: formKind,
            onChange: (event) => setFormKind(event.target.value),
            "aria-label": "\u65B0\u589E kind",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "cli", children: "cli" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "a2a", children: "a2a" })
            ]
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: CoAgentHubExecutorsPanel_default.field, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: CoAgentHubExecutorsPanel_default.fieldLabel, children: "args" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "input",
          {
            className: CoAgentHubExecutorsPanel_default.input,
            value: formArgs,
            onChange: (event) => setFormArgs(event.target.value),
            placeholder: "\u7A7A\u683C\u5206\u9694,\u5982 -y -p {ticket}",
            "aria-label": "\u65B0\u589E args"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: CoAgentHubExecutorsPanel_default.field, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: CoAgentHubExecutorsPanel_default.fieldLabel, children: "model" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "input",
          {
            className: CoAgentHubExecutorsPanel_default.input,
            value: formModel,
            onChange: (event) => setFormModel(event.target.value),
            placeholder: "\u53EF\u9009",
            "aria-label": "\u65B0\u589E model"
          }
        )
      ] }),
      submitError !== null && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: CoAgentHubExecutorsPanel_default.error, role: "alert", children: submitError }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "submit", className: CoAgentHubExecutorsPanel_default.submit, disabled: submitting, children: submitting ? "\u63D0\u4EA4\u4E2D\u2026" : "\u6DFB\u52A0" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: CoAgentHubExecutorsPanel_default.body, children: [
      actionError !== null && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: CoAgentHubExecutorsPanel_default.error, role: "alert", children: actionError }),
      state.kind === "loading" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: CoAgentHubExecutorsPanel_default.loading, children: "\u52A0\u8F7D\u4E2D\u2026" }),
      state.kind === "error" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: CoAgentHubExecutorsPanel_default.error, role: "alert", children: [
        "\u52A0\u8F7D\u5931\u8D25:",
        state.message
      ] }),
      state.kind === "ready" && executors.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: CoAgentHubExecutorsPanel_default.empty, children: "\u6682\u65E0\u6267\u884C\u5668" }),
      state.kind === "ready" && executors.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ul", { className: CoAgentHubExecutorsPanel_default.list, children: executors.map((executor) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: CoAgentHubExecutorsPanel_default.row, "data-builtin": executor.builtin || void 0, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: CoAgentHubExecutorsPanel_default.rowMain, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: CoAgentHubExecutorsPanel_default.rowTop, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: CoAgentHubExecutorsPanel_default.key, children: executor.key }),
            executor.builtin && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: CoAgentHubExecutorsPanel_default.builtin, children: "\u5185\u7F6E" }),
            executor.model !== void 0 && executor.model !== null && executor.model !== "" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: CoAgentHubExecutorsPanel_default.model, children: executor.model })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: CoAgentHubExecutorsPanel_default.meta, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: CoAgentHubExecutorsPanel_default.agentName, children: executor.agentName }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: CoAgentHubExecutorsPanel_default.bin, children: executor.bin })
          ] }),
          argsPreview(executor.args) !== "" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: CoAgentHubExecutorsPanel_default.args, children: argsPreview(executor.args) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: CoAgentHubExecutorsPanel_default.rowActions, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "button",
              className: CoAgentHubExecutorsPanel_default.copy,
              "data-copied": copiedKey === executor.key || void 0,
              onClick: () => copyKey(executor.key),
              title: `${executor.key}\uFF08\u590D\u5236\uFF09`,
              children: copiedKey === executor.key ? "\u5DF2\u590D\u5236" : "\u590D\u5236 key"
            }
          ),
          !executor.builtin && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "button",
              className: CoAgentHubExecutorsPanel_default.delete,
              onClick: () => handleDelete(executor),
              title: "\u5220\u9664",
              children: "\u5220\u9664"
            }
          )
        ] })
      ] }) }, executor.key)) })
    ] })
  ] });
}

// src/client-ui/CoAgentHubSettings.tsx
var import_react4 = require("react");

// src/client-ui/CoAgentHubSettings.module.css
var css5 = "/* CoAgentHub settings form (browser half). Fills the \u8BBE\u7F6E tab of the CoAgentHub\n   panel: a small form for the CoAgentHub address + participantId with a \u4FDD\u5B58\n   button; the host half applies the change immediately. Uses the dsw theme\n   aliases so dark mode and future theme changes apply. */\n\n.c1e28c7e8_content {\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n  flex: 1;\n  overflow-y: auto;\n}\n\n.cf695c204_header {\n  padding: 10px 14px 8px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.c1dbb162d_title {\n  margin: 0;\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.cb7296f84_form {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  padding: 12px 14px;\n}\n\n.c7eec46df_field {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.cfc4ba57d_label {\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n}\n\n.c891e3397_input {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 4px 8px;\n  font: inherit;\n  font-size: 12px;\n  color: inherit;\n  background: var(--dsw-alias-bg-base);\n}\n\n.c891e3397_input::placeholder {\n  color: var(--dsw-alias-label-dimmed);\n}\n\n.ce1d0ea1b_actions {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.c9393f387_save {\n  flex: none;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 4px 14px;\n  font: inherit;\n  font-size: 12px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  cursor: pointer;\n}\n\n.c9393f387_save:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c4d296080_saved {\n  margin: 0;\n  font-size: 12px;\n  color: #1a7f37;\n}\n\n.cb05a4758_error {\n  margin: 0;\n  font-size: 12px;\n  color: var(--dsw-alias-label-error, #cf222e);\n}\n\n/* \u5F53\u524D\u8EAB\u4EFD\u4E0E\u5DE5\u4F5C\u533A:\u53EA\u8BFB\u72B6\u6001\u533A(participantId + \u5DE5\u4F5C\u533A\u7FA4\u540D)\u3002 */\n.c488e1b33_statusSection {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  padding: 12px 14px;\n  border-top: 1px solid var(--dsw-alias-border-l1);\n}\n\n.c697f3461_statusRow {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.c51ea5955_statusValue {\n  font-size: 12px;\n  overflow-wrap: anywhere;\n}\n\n.ca20db214_copy {\n  flex: none;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 2px 10px;\n  font: inherit;\n  font-size: 11px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  cursor: pointer;\n}\n\n.ca20db214_copy:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n/* \u865A\u62DF\u5DE5\u4F5C\u533A:\u6620\u5C04\u89C4\u5219\u72B6\u6001 + \u4E00\u952E\u8BBE\u7F6E\u8868\u5355\u3002 */\n.cca83d3c8_wsSection {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 12px 14px;\n  border-top: 1px solid var(--dsw-alias-border-l1);\n}\n\n.cf5cc1a58_wsTitle {\n  margin: 0;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.c31eb57bc_wsStatus {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.c28f21ac1_wsRule {\n  margin: 0;\n  font-size: 12px;\n  overflow-wrap: anywhere;\n}\n\n.c3317bae3_wsMeta {\n  margin: 0;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n}\n\n.cd57336ea_wsNote {\n  margin: 0;\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n}\n\n.c53032779_wsError {\n  margin: 0;\n  font-size: 12px;\n  color: var(--dsw-alias-label-error, #cf222e);\n}\n\n.c6612d5c5_wsForm {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n\n.c155f8e42_wsResult {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.c08dc1d46_wsOk {\n  margin: 0;\n  font-size: 12px;\n  color: #1a7f37;\n}\n\n.c6b8cb422_wsFailures {\n  margin: 0;\n  padding-left: 16px;\n  font-size: 12px;\n}\n";
var tagId5 = "@laizhixingxingdeli/dsh-coagenthub/CoAgentHubSettings.module.css";
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="' + tagId5 + '"]')) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@laizhixingxingdeli/dsh-coagenthub";
  tag.dataset.pluginCss = tagId5;
  tag.textContent = css5;
  document.head.appendChild(tag);
}
var CoAgentHubSettings_default = { "content": "c1e28c7e8_content", "header": "cf695c204_header", "title": "c1dbb162d_title", "form": "cb7296f84_form", "field": "c7eec46df_field", "label": "cfc4ba57d_label", "input": "c891e3397_input", "actions": "ce1d0ea1b_actions", "save": "c9393f387_save", "saved": "c4d296080_saved", "error": "cb05a4758_error", "statusSection": "c488e1b33_statusSection", "statusRow": "c697f3461_statusRow", "statusValue": "c51ea5955_statusValue", "copy": "ca20db214_copy", "wsSection": "cca83d3c8_wsSection", "wsTitle": "cf5cc1a58_wsTitle", "wsStatus": "c31eb57bc_wsStatus", "wsRule": "c28f21ac1_wsRule", "wsMeta": "c3317bae3_wsMeta", "wsNote": "cd57336ea_wsNote", "wsError": "c53032779_wsError", "wsForm": "c6612d5c5_wsForm", "wsResult": "c155f8e42_wsResult", "wsOk": "c08dc1d46_wsOk", "wsFailures": "c6b8cb422_wsFailures" };

// src/client-ui/workspace-status.ts
var SETTINGS_PATH = "/coagenthub-api-config";
var WORKSPACE_SETUP_PATH = "/coagenthub-api/workspace-setup";
var WORKSPACE_STATUS_PATH = "/coagenthub-api/workspace-status";
var ACTIVE_GROUP_STORAGE_KEY = "coagenthub.activeGroupId";
var DSH_SESSION_STORAGE_KEY = "dsh.sessions.current";
var ACTIVE_GROUP_SESSION_KEY_PREFIX = "coagenthub.activeGroup.";
function getCurrentDshSessionId() {
  try {
    const raw = localStorage.getItem(DSH_SESSION_STORAGE_KEY);
    if (raw === null || raw === "") return null;
    const parsed = JSON.parse(raw);
    return typeof parsed.sessionId === "string" && parsed.sessionId !== "" ? parsed.sessionId : null;
  } catch {
    return null;
  }
}
function activeGroupSessionKey(sessionId) {
  return `${ACTIVE_GROUP_SESSION_KEY_PREFIX}${sessionId}`;
}
async function fetchWorkspaceStatus() {
  const response = await fetch(WORKSPACE_STATUS_PATH);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return { mappingRule: data.mappingRule ?? null, workspaces: data.workspaces ?? [] };
}
async function saveActiveGroupId(groupId) {
  const sessionId = getCurrentDshSessionId();
  const body = sessionId === null ? { activeGroupId: groupId ?? "" } : { sessionActiveGroups: { [sessionId]: groupId ?? "" } };
  const response = await fetch(SETTINGS_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    // 空串而非 undefined:JSON.stringify 会丢弃 undefined 键,导致 host 收不到
    // 清除信号、镜像里残留旧值;空串会被 host 的 clean() 丢弃,即清除。
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
function readSessionActiveGroupId() {
  try {
    const sessionId = getCurrentDshSessionId();
    if (sessionId === null) return null;
    const raw = localStorage.getItem(activeGroupSessionKey(sessionId));
    return raw !== null && raw !== "" ? raw : null;
  } catch {
    return null;
  }
}
function writeActiveGroupId(groupId) {
  try {
    const sessionId = getCurrentDshSessionId();
    if (groupId === null || groupId === "") {
      localStorage.removeItem(ACTIVE_GROUP_STORAGE_KEY);
      if (sessionId !== null) localStorage.removeItem(activeGroupSessionKey(sessionId));
    } else {
      localStorage.setItem(ACTIVE_GROUP_STORAGE_KEY, groupId);
      if (sessionId !== null) localStorage.setItem(activeGroupSessionKey(sessionId), groupId);
    }
  } catch {
  }
}
function isWindowsPlatform(platform = navigator.platform) {
  return platform.toLowerCase().includes("win");
}

// src/client-ui/CoAgentHubSettings.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
async function fetchSettings() {
  const response = await fetch(SETTINGS_PATH);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}
async function saveSettings(patch) {
  const response = await fetch(SETTINGS_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data.settings ?? patch;
}
function CoAgentHubSettings({ onSaved, activeGroupId: sessionActiveGroupId }) {
  const [apiBase, setApiBase] = (0, import_react4.useState)("");
  const [participantId, setParticipantId] = (0, import_react4.useState)("");
  const [activeGroupId, setActiveGroupId] = (0, import_react4.useState)("");
  const [loadState, setLoadState] = (0, import_react4.useState)({ kind: "idle" });
  const [saveState, setSaveState] = (0, import_react4.useState)({ kind: "idle" });
  const [status, setStatus] = (0, import_react4.useState)(null);
  const [statusError, setStatusError] = (0, import_react4.useState)(null);
  const [shareName, setShareName] = (0, import_react4.useState)("");
  const [macUser, setMacUser] = (0, import_react4.useState)("");
  const [macPassword, setMacPassword] = (0, import_react4.useState)("");
  const [driveLetter, setDriveLetter] = (0, import_react4.useState)("Z");
  const [setup, setSetup] = (0, import_react4.useState)({ kind: "idle" });
  (0, import_react4.useEffect)(() => {
    let alive = true;
    fetchSettings().then(
      (settings) => {
        if (!alive) return;
        setApiBase(settings.apiBase ?? "");
        setParticipantId(settings.participantId ?? "");
        setActiveGroupId(settings.activeGroupId ?? "");
        setLoadState({ kind: "ready" });
      },
      (error) => {
        if (alive) setLoadState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    );
    return () => {
      alive = false;
    };
  }, []);
  (0, import_react4.useEffect)(() => {
    let alive = true;
    fetchWorkspaceStatus().then(
      (view) => {
        if (!alive) return;
        setStatus(view);
        setStatusError(null);
      },
      (error) => {
        if (alive) setStatusError(error instanceof Error ? error.message : String(error));
      }
    );
    return () => {
      alive = false;
    };
  }, []);
  const handleSubmit = (event) => {
    event.preventDefault();
    void saveSettings({
      apiBase: apiBase.trim() === "" ? "" : apiBase.trim(),
      participantId: participantId.trim() === "" ? "" : participantId.trim()
    }).then(
      () => {
        setSaveState({ kind: "ready" });
        onSaved?.();
      },
      (error) => {
        setSaveState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    );
  };
  const handleSetup = (event) => {
    event.preventDefault();
    setSetup({ kind: "running" });
    void fetch(WORKSPACE_SETUP_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shareName: shareName.trim(),
        macUser: macUser.trim() === "" ? void 0 : macUser.trim(),
        macPassword: macPassword === "" ? void 0 : macPassword,
        driveLetter: driveLetter.trim() === "" ? void 0 : driveLetter.trim()
      })
    }).then(
      async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          setSetup({ kind: "error", message: body.error ?? `HTTP ${response.status}` });
          return;
        }
        setSetup({ kind: "done", result: body });
        try {
          setStatus(await fetchWorkspaceStatus());
          setStatusError(null);
        } catch (error) {
          setStatusError(error instanceof Error ? error.message : String(error));
        }
      },
      (error) => {
        setSetup({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    );
  };
  const windows = isWindowsPlatform();
  const workspaces = status?.workspaces ?? [];
  const registeredCount = workspaces.filter((workspace) => workspace.registered === true).length;
  const displayGroupId = sessionActiveGroupId !== void 0 ? sessionActiveGroupId : activeGroupId;
  const activeWorkspace = workspaces.find((workspace) => workspace.groupId === displayGroupId);
  const activeGroupTitle = displayGroupId.trim() === "" ? "\u81EA\u52A8\uFF08\u6309 cwd\uFF09" : activeWorkspace?.groupTitle ?? displayGroupId;
  const handleCopyParticipantId = () => {
    const value = participantId.trim();
    if (value === "") return;
    void navigator.clipboard?.writeText(value).catch(() => {
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: CoAgentHubSettings_default.content, "aria-label": "CoAgentHub \u8BBE\u7F6E", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("header", { className: CoAgentHubSettings_default.header, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h2", { className: CoAgentHubSettings_default.title, children: "CoAgentHub \u8BBE\u7F6E" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("form", { className: CoAgentHubSettings_default.form, onSubmit: handleSubmit, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: CoAgentHubSettings_default.field, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: CoAgentHubSettings_default.label, children: "CoAgentHub \u5730\u5740" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "input",
          {
            className: CoAgentHubSettings_default.input,
            value: apiBase,
            onChange: (event) => setApiBase(event.target.value),
            placeholder: "http://localhost:3001/api",
            "aria-label": "CoAgentHub \u5730\u5740"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: CoAgentHubSettings_default.field, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: CoAgentHubSettings_default.label, children: "participantId" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "input",
          {
            className: CoAgentHubSettings_default.input,
            value: participantId,
            onChange: (event) => setParticipantId(event.target.value),
            placeholder: "\u53EF\u9009",
            "aria-label": "participantId"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: CoAgentHubSettings_default.actions, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "submit", className: CoAgentHubSettings_default.save, children: "\u4FDD\u5B58" }),
        saveState.kind === "ready" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: CoAgentHubSettings_default.saved, role: "status", children: "\u5DF2\u4FDD\u5B58,\u7ACB\u5373\u751F\u6548" })
      ] }),
      loadState.kind === "error" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: CoAgentHubSettings_default.error, role: "alert", children: [
        "\u8BBE\u7F6E\u52A0\u8F7D\u5931\u8D25:",
        loadState.message
      ] }),
      saveState.kind === "error" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: CoAgentHubSettings_default.error, role: "alert", children: [
        "\u4FDD\u5B58\u5931\u8D25:",
        saveState.message
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: CoAgentHubSettings_default.statusSection, "aria-label": "\u5F53\u524D\u8EAB\u4EFD\u4E0E\u5DE5\u4F5C\u533A", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { className: CoAgentHubSettings_default.wsTitle, children: "\u5F53\u524D\u8EAB\u4EFD\u4E0E\u5DE5\u4F5C\u533A" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: CoAgentHubSettings_default.statusRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: CoAgentHubSettings_default.label, children: "\u5F53\u524D participantId" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: CoAgentHubSettings_default.statusValue, "aria-label": "\u5F53\u524D participantId", children: participantId.trim() === "" ? "\u672A\u8BBE\u7F6E" : participantId }),
        participantId.trim() !== "" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: CoAgentHubSettings_default.copy, onClick: handleCopyParticipantId, "aria-label": "\u590D\u5236 participantId", children: "\u590D\u5236" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: CoAgentHubSettings_default.statusRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: CoAgentHubSettings_default.label, children: "\u5F53\u524D\u5DE5\u4F5C\u533A" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: CoAgentHubSettings_default.statusValue, "aria-label": "\u5F53\u524D\u5DE5\u4F5C\u533A\u7FA4\u540D", children: activeGroupTitle })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: CoAgentHubSettings_default.wsSection, "aria-label": "\u865A\u62DF\u5DE5\u4F5C\u533A", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { className: CoAgentHubSettings_default.wsTitle, children: "\u865A\u62DF\u5DE5\u4F5C\u533A" }),
      statusError !== null && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: CoAgentHubSettings_default.wsError, children: statusError }),
      status !== null && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: CoAgentHubSettings_default.wsStatus, children: [
        status.mappingRule !== null ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: CoAgentHubSettings_default.wsRule, children: [
          status.mappingRule.macPrefix,
          " \u2192 ",
          status.mappingRule.winPrefix
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: CoAgentHubSettings_default.wsRule, children: "\u672A\u914D\u7F6E\u8DEF\u5F84\u6620\u5C04\u89C4\u5219" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: CoAgentHubSettings_default.wsMeta, children: [
          "\u5DF2\u6CE8\u518C ",
          registeredCount,
          "/",
          workspaces.length,
          " \u4E2A\u865A\u62DF\u5DE5\u4F5C\u533A"
        ] })
      ] }),
      !windows && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: CoAgentHubSettings_default.wsNote, children: "\u81EA\u52A8\u6620\u5C04\u4EC5 Windows \u652F\u6301" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("form", { className: CoAgentHubSettings_default.wsForm, onSubmit: handleSetup, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: CoAgentHubSettings_default.field, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: CoAgentHubSettings_default.label, children: "\u5171\u4EAB\u540D(Share Name)" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "input",
            {
              className: CoAgentHubSettings_default.input,
              value: shareName,
              onChange: (event) => setShareName(event.target.value),
              placeholder: "Projects",
              "aria-label": "\u5171\u4EAB\u540D"
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: CoAgentHubSettings_default.field, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: CoAgentHubSettings_default.label, children: "Mac \u8D26\u53F7(\u53EF\u9009)" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "input",
            {
              className: CoAgentHubSettings_default.input,
              value: macUser,
              onChange: (event) => setMacUser(event.target.value),
              "aria-label": "Mac \u8D26\u53F7"
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: CoAgentHubSettings_default.field, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: CoAgentHubSettings_default.label, children: "Mac \u5BC6\u7801(\u53EF\u9009)" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "input",
            {
              className: CoAgentHubSettings_default.input,
              type: "password",
              value: macPassword,
              onChange: (event) => setMacPassword(event.target.value),
              "aria-label": "Mac \u5BC6\u7801"
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: CoAgentHubSettings_default.field, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: CoAgentHubSettings_default.label, children: "\u76D8\u7B26" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "input",
            {
              className: CoAgentHubSettings_default.input,
              value: driveLetter,
              onChange: (event) => setDriveLetter(event.target.value),
              placeholder: "Z",
              "aria-label": "\u76D8\u7B26"
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: CoAgentHubSettings_default.actions, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            "button",
            {
              type: "submit",
              className: CoAgentHubSettings_default.save,
              disabled: !windows || setup.kind === "running",
              "aria-label": "\u4E00\u952E\u8BBE\u7F6E",
              children: setup.kind === "running" ? "\u8BBE\u7F6E\u4E2D\u2026" : "\u4E00\u952E\u8BBE\u7F6E"
            }
          ),
          setup.kind === "error" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: CoAgentHubSettings_default.wsError, role: "alert", children: [
            "\u8BBE\u7F6E\u5931\u8D25:",
            setup.message
          ] }),
          setup.kind === "done" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: CoAgentHubSettings_default.wsResult, children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: CoAgentHubSettings_default.wsOk, role: "status", children: [
              "\u8BBE\u7F6E\u5B8C\u6210:\u6CE8\u518C ",
              setup.result.mapped?.length ?? 0,
              " \u4E2A,\u5931\u8D25 ",
              setup.result.failures?.length ?? 0,
              " \u4E2A"
            ] }),
            (setup.result.failures?.length ?? 0) > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("ul", { className: CoAgentHubSettings_default.wsFailures, children: setup.result.failures.map((failure) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { children: [
              failure.groupTitle,
              ":",
              failure.reason
            ] }, failure.groupTitle)) })
          ] })
        ] })
      ] })
    ] })
  ] });
}

// src/client-ui/CoAgentHubPanel.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var PANEL_TABS = [
  { id: "groups", label: "\u7FA4\u5217\u8868" },
  { id: "tasks", label: "\u4EFB\u52A1" },
  { id: "executors", label: "\u6267\u884C\u5668" },
  { id: "settings", label: "\u8BBE\u7F6E" }
];
var PANEL_SIZE_KEY = "coagenthub.panelSize";
var DEFAULT_SIZE = { width: 360, height: 620 };
var MIN_SIZE = { width: 280, height: 320 };
var MAX_SIZE = { width: 640, height: 900 };
function readSavedSize() {
  try {
    const raw = localStorage.getItem(PANEL_SIZE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.width === "number" && typeof parsed.height === "number") {
        return {
          width: Math.min(MAX_SIZE.width, Math.max(MIN_SIZE.width, parsed.width)),
          height: Math.min(MAX_SIZE.height, Math.max(MIN_SIZE.height, parsed.height))
        };
      }
    }
  } catch {
  }
  return DEFAULT_SIZE;
}
var PANEL_POSITION_KEY = "coagenthub.panelPosition";
var MIN_VISIBLE_PX = 48;
function clampPanelPosition(left, top, width, height) {
  const minLeft = -width + MIN_VISIBLE_PX;
  const maxLeft = window.innerWidth - MIN_VISIBLE_PX;
  const minTop = -height + MIN_VISIBLE_PX;
  const maxTop = window.innerHeight - MIN_VISIBLE_PX;
  return {
    left: Math.min(maxLeft, Math.max(minLeft, left)),
    top: Math.min(maxTop, Math.max(minTop, top))
  };
}
function readSavedPosition() {
  try {
    const raw = localStorage.getItem(PANEL_POSITION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.left === "number" && Number.isFinite(parsed.left) && typeof parsed.top === "number" && Number.isFinite(parsed.top)) {
        return { left: parsed.left, top: parsed.top };
      }
    }
  } catch {
  }
  return null;
}
function CoAgentHubPanel({ apiBase = DEFAULT_API_BASE }) {
  const [tab, setTab] = (0, import_react5.useState)("groups");
  const [taskDetailOpen, setTaskDetailOpen] = (0, import_react5.useState)(false);
  const [reloadKey, setReloadKey] = (0, import_react5.useState)(0);
  const [size, setSize] = (0, import_react5.useState)(readSavedSize);
  const sizeRef = (0, import_react5.useRef)(size);
  sizeRef.current = size;
  const resizeStart = (0, import_react5.useRef)(null);
  const panelRef = (0, import_react5.useRef)(null);
  const [position, setPosition] = (0, import_react5.useState)(() => {
    const saved = readSavedPosition();
    if (saved === null) return null;
    const restoredSize = readSavedSize();
    return clampPanelPosition(saved.left, saved.top, restoredSize.width, restoredSize.height);
  });
  const positionRef = (0, import_react5.useRef)(position);
  positionRef.current = position;
  const dragStart = (0, import_react5.useRef)(null);
  const [activeGroupId, setActiveGroupId] = (0, import_react5.useState)(() => readSessionActiveGroupId());
  const [workspaceDraft, setWorkspaceDraft] = (0, import_react5.useState)(() => readSessionActiveGroupId());
  const [workspaceStatus, setWorkspaceStatus] = (0, import_react5.useState)(null);
  const lastSessionIdRef = (0, import_react5.useRef)(null);
  const lastMirroredHostRef = (0, import_react5.useRef)(null);
  const syncHostActiveGroupId = (0, import_react5.useCallback)((saved) => {
    const sessionId = getCurrentDshSessionId();
    const last = lastMirroredHostRef.current;
    if (last !== null && last.sessionId === sessionId && last.groupId === saved) return;
    lastMirroredHostRef.current = { sessionId, groupId: saved };
    void saveActiveGroupId(saved).catch(() => {
    });
  }, []);
  (0, import_react5.useEffect)(() => {
    let alive = true;
    fetchWorkspaceStatus().then(
      (view) => {
        if (alive) setWorkspaceStatus(view);
      },
      () => {
        if (alive) setWorkspaceStatus(null);
      }
    );
    const saved = readSessionActiveGroupId();
    setActiveGroupId(saved);
    setWorkspaceDraft(saved);
    syncHostActiveGroupId(saved);
    return () => {
      alive = false;
    };
  }, [reloadKey, syncHostActiveGroupId]);
  (0, import_react5.useEffect)(() => {
    const refreshForSession = () => {
      const sessionId = getCurrentDshSessionId();
      if (sessionId !== lastSessionIdRef.current) {
        lastSessionIdRef.current = sessionId;
        const saved = readSessionActiveGroupId();
        setActiveGroupId(saved);
        setWorkspaceDraft(saved);
        syncHostActiveGroupId(saved);
      }
    };
    const forceRefresh = () => {
      lastSessionIdRef.current = getCurrentDshSessionId();
      const saved = readSessionActiveGroupId();
      setActiveGroupId(saved);
      setWorkspaceDraft(saved);
      syncHostActiveGroupId(saved);
    };
    refreshForSession();
    const timer = window.setInterval(refreshForSession, 1e3);
    const onVisibility = () => {
      if (document.visibilityState === "visible") forceRefresh();
    };
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", forceRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", forceRefresh);
    };
  }, [syncHostActiveGroupId]);
  const handleWorkspaceChange = (event) => {
    const next = event.target.value === "" ? null : event.target.value;
    setWorkspaceDraft(next);
  };
  const handleWorkspaceSave = () => {
    writeActiveGroupId(workspaceDraft);
    setActiveGroupId(workspaceDraft);
    lastMirroredHostRef.current = { sessionId: getCurrentDshSessionId(), groupId: workspaceDraft };
    void saveActiveGroupId(workspaceDraft).catch(() => {
    });
  };
  const onResizePointerDown = (0, import_react5.useCallback)((e) => {
    e.preventDefault();
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.width, h: size.height };
    const onMove = (ev) => {
      if (!resizeStart.current) return;
      const { x, y, w, h } = resizeStart.current;
      const nextW = Math.min(MAX_SIZE.width, Math.max(MIN_SIZE.width, w + (ev.clientX - x)));
      const nextH = Math.min(MAX_SIZE.height, Math.max(MIN_SIZE.height, h + (ev.clientY - y)));
      setSize({ width: nextW, height: nextH });
      sizeRef.current = { width: nextW, height: nextH };
    };
    const onUp = () => {
      resizeStart.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try {
        localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(sizeRef.current));
      } catch {
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [size]);
  const onDragPointerDown = (0, import_react5.useCallback)((e) => {
    e.preventDefault();
    const rect = panelRef.current?.getBoundingClientRect();
    const current = positionRef.current;
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      left: current?.left ?? rect?.left ?? 0,
      top: current?.top ?? rect?.top ?? 0
    };
    const onMove = (ev) => {
      if (!dragStart.current) return;
      const { x, y, left, top } = dragStart.current;
      const next = clampPanelPosition(left + (ev.clientX - x), top + (ev.clientY - y), sizeRef.current.width, sizeRef.current.height);
      setPosition(next);
      positionRef.current = next;
    };
    const onUp = () => {
      dragStart.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try {
        localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(positionRef.current));
      } catch {
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);
  (0, import_react5.useEffect)(() => {
    if (tab !== "tasks") setTaskDetailOpen(false);
  }, [tab]);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
    "section",
    {
      ref: panelRef,
      className: CoAgentHubPanel_default.panel,
      "data-detail-open": taskDetailOpen || void 0,
      "aria-label": "CoAgentHub \u9762\u677F",
      style: {
        width: size.width,
        height: size.height,
        // 有保存位置时用 left/top 定位(并清掉 CSS 的 right),否则默认右上角。
        ...position !== null ? { left: position.left, top: position.top, right: "auto" } : {}
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("header", { className: CoAgentHubPanel_default.header, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h2", { className: CoAgentHubPanel_default.title, onPointerDown: onDragPointerDown, children: "CoAgentHub" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: CoAgentHubPanel_default.tabs, role: "tablist", "aria-label": "\u9762\u677F\u5207\u6362", children: PANEL_TABS.map(({ id, label }) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              type: "button",
              role: "tab",
              "aria-selected": tab === id,
              "data-active": tab === id || void 0,
              className: CoAgentHubPanel_default.tab,
              onClick: () => setTab(id),
              children: label
            },
            id
          )) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: CoAgentHubPanel_default.workspaceBar, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("label", { className: CoAgentHubPanel_default.workspaceLabel, htmlFor: "coagenthub-workspace-select", children: "\u5F53\u524D\u5DE5\u4F5C\u533A" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
            "select",
            {
              id: "coagenthub-workspace-select",
              className: CoAgentHubPanel_default.workspaceSelect,
              value: workspaceDraft ?? "",
              onChange: handleWorkspaceChange,
              "aria-label": "\u5F53\u524D\u5DE5\u4F5C\u533A",
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "", children: "\u81EA\u52A8\uFF08\u6309 cwd\uFF09" }),
                (workspaceStatus?.workspaces ?? []).map((workspace) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("option", { value: workspace.groupId, children: [
                  workspace.groupTitle,
                  "(",
                  workspace.winPath ?? workspace.macPath,
                  ")"
                ] }, workspace.groupId))
              ]
            }
          ),
          workspaceDraft !== activeGroupId && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              type: "button",
              className: CoAgentHubPanel_default.workspaceSave,
              onClick: handleWorkspaceSave,
              "aria-label": "\u4FDD\u5B58\u5DE5\u4F5C\u533A",
              children: "\u4FDD\u5B58"
            }
          ),
          !isWindowsPlatform() && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: CoAgentHubPanel_default.workspaceNote, children: "\u81EA\u52A8\u6620\u5C04\u4EC5 Windows \u652F\u6301" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: CoAgentHubPanel_default.body, children: [
          tab === "groups" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CoAgentHubGroupList, { apiBase }, `groups-${reloadKey}`),
          tab === "tasks" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            CoAgentHubTaskPanel,
            {
              apiBase,
              defaultGroupId: activeGroupId ?? void 0,
              onDetailChange: setTaskDetailOpen
            },
            `tasks-${reloadKey}`
          ),
          tab === "executors" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CoAgentHubExecutorsPanel, { apiBase }, `executors-${reloadKey}`),
          tab === "settings" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            CoAgentHubSettings,
            {
              onSaved: () => setReloadKey((v) => v + 1),
              activeGroupId: activeGroupId ?? ""
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "div",
          {
            className: CoAgentHubPanel_default.resizeHandle,
            role: "separator",
            "aria-orientation": "horizontal",
            "aria-label": "\u8C03\u6574\u9762\u677F\u5927\u5C0F",
            onPointerDown: onResizePointerDown
          }
        )
      ]
    }
  );
}

// src/client-ui/index.ts
var inject = ["slots"];
function apply(ctx) {
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "coagenthub-panel"
  }, CoAgentHubPanel));
}
return module.exports; } });
