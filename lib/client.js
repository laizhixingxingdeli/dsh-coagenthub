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
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client-ui/CoAgentHubGroupList.tsx
var import_react = require("react");

// src/client-ui/CoAgentHubGroupList.module.css
var css = "/* CoAgentHub group-list panel (browser half). Right-side floating panel\n   styled after the dsh DetailsPanel: header over a scrolling list, using the\n   dsw theme aliases so dark mode and future theme changes apply. */\n\n.c5e1486db_panel {\n  position: fixed;\n  top: 16px;\n  right: 16px;\n  z-index: 100;\n  width: 320px;\n  max-height: min(70vh, 640px);\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 12px;\n  background: var(--dsw-alias-bg-base);\n  color: var(--dsw-alias-label-primary, #1f2328);\n  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);\n  font-size: 13px;\n  line-height: 1.4;\n  pointer-events: auto;\n}\n\n.c15a64b79_header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 12px 14px 10px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.c49941949_titleWrap {\n  display: flex;\n  align-items: baseline;\n  gap: 8px;\n  min-width: 0;\n}\n\n.c942eccad_title {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 600;\n  letter-spacing: 0.2px;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.cc7af2bf4_count {\n  flex: none;\n  padding: 1px 8px;\n  border-radius: 999px;\n  font-size: 11px;\n  font-weight: 500;\n  color: var(--dsw-alias-label-dimmed);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c40284cda_refresh {\n  flex: none;\n  border: 1px solid transparent;\n  border-radius: 6px;\n  padding: 3px 8px;\n  font: inherit;\n  font-size: 12px;\n  color: var(--dsw-alias-label-caption);\n  background: transparent;\n  cursor: pointer;\n}\n\n.c40284cda_refresh:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c95165155_body {\n  overflow-y: auto;\n  padding: 6px;\n}\n\n.c1c495ea2_hint {\n  margin: 0;\n  padding: 2px 8px 8px;\n  color: var(--dsw-alias-label-dimmed);\n  font-size: 12px;\n}\n\n.cd9c9755b_list {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.c082ccf0b_row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  width: 100%;\n  padding: 7px 10px;\n  border: 1px solid transparent;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  transition: background 0.12s ease;\n}\n\n.c082ccf0b_row:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.c082ccf0b_row[data-copied='true'] {\n  border-color: var(--dsw-alias-brand-primary);\n  background: var(--dsw-alias-interactive-bg-primary, rgba(76, 139, 245, 0.12));\n}\n\n.c4d74c9d1_rowMain {\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.c942eccad_title {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.c126061da_meta {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.ca47dfac6_dot {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  flex: none;\n}\n\n.ca47dfac6_dot[data-state='active'] {\n  background: #2da44e;\n}\n\n.ca47dfac6_dot[data-state='archived'] {\n  background: var(--dsw-alias-label-dimmed);\n}\n\n.c21fca710_statusText {\n  font-size: 11px;\n  color: var(--dsw-alias-label-caption);\n}\n\n.caf4fed6f_copied {\n  flex: none;\n  font-size: 11px;\n  color: var(--dsw-alias-brand-primary);\n}\n\n.c67968ba0_empty,\n.c4d212a29_error,\n.c55702099_loading {\n  margin: 0;\n  padding: 14px 10px;\n  color: var(--dsw-alias-label-dimmed);\n  text-align: center;\n}\n\n.c4d212a29_error {\n  color: var(--dsw-alias-label-error, #cf222e);\n  text-align: left;\n  font-size: 12px;\n}\n";
var tagId = "@laizhixingxingdeli/dsh-coagenthub/CoAgentHubGroupList.module.css";
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="' + tagId + '"]')) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@laizhixingxingdeli/dsh-coagenthub";
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
var CoAgentHubGroupList_default = { "panel": "c5e1486db_panel", "header": "c15a64b79_header", "titleWrap": "c49941949_titleWrap", "title": "c942eccad_title", "count": "cc7af2bf4_count", "refresh": "c40284cda_refresh", "body": "c95165155_body", "hint": "c1c495ea2_hint", "list": "cd9c9755b_list", "row": "c082ccf0b_row", "rowMain": "c4d74c9d1_rowMain", "meta": "c126061da_meta", "dot": "ca47dfac6_dot", "statusText": "c21fca710_statusText", "copied": "caf4fed6f_copied", "empty": "c67968ba0_empty", "error": "c4d212a29_error", "loading": "c55702099_loading" };

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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: CoAgentHubGroupList_default.panel, "aria-label": "CoAgentHub \u7FA4\u5217\u8868", children: [
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
              ] })
            ] }),
            copiedId === group.id && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: CoAgentHubGroupList_default.copied, children: "\u5DF2\u590D\u5236" })
          ]
        }
      ) }, group.id)) })
    ] })
  ] });
}

// src/client-ui/index.ts
var inject = ["slots"];
function apply(ctx) {
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "coagenthub-groups"
  }, CoAgentHubGroupList));
}
return module.exports; } });
