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
var css = "/* CoAgentHub group-list panel, mounted into the shell.d8f160b0_overlay seat. The\n   overlay layer is click-through by default; the panel opts back into\n   pointer events so rows can be clicked to copy a group id. */\n\n.5e1486db_panel {\n  position: fixed;\n  top: 16px;\n  right: 16px;\n  z-index: 100;\n  width: 280px;\n  max-height: 70vh;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 12px;\n  border: 1px solid var(--ds-border-color, rgba(128, 128, 128, 0.35));\n  border-radius: 10px;\n  background: var(--ds-surface-color, #ffffff);\n  color: var(--ds-text-color, #1f2328);\n  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);\n  font-size: 13px;\n  pointer-events: auto;\n  overflow-y: auto;\n}\n\n.882381d3_heading {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 600;\n}\n\n.1c495ea2_hint {\n  margin: 0;\n  color: var(--ds-text-secondary-color, rgba(31, 35, 40, 0.6));\n  font-size: 12px;\n}\n\n.d9c9755b_list {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.082ccf0b_row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  width: 100%;\n  padding: 6px 8px;\n  border: 1px solid transparent;\n  border-radius: 6px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n}\n\n.082ccf0b_row:hover {\n  background: var(--ds-hover-color, rgba(128, 128, 128, 0.12));\n}\n\n.082ccf0b_row[data-copied='true'] {\n  border-color: var(--ds-accent-color, #4c8bf5);\n}\n\n.942eccad_title {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.552408ae_status {\n  flex: none;\n  padding: 1px 6px;\n  border-radius: 999px;\n  font-size: 11px;\n}\n\n.552408ae_status[data-state='active'] {\n  color: #1a7f37;\n  background: rgba(26, 127, 55, 0.12);\n}\n\n.552408ae_status[data-state='archived'] {\n  color: rgba(31, 35, 40, 0.55);\n  background: rgba(128, 128, 128, 0.14);\n}\n\n.67968ba0_empty,\n.4d212a29_error,\n.55702099_loading {\n  margin: 0;\n  padding: 6px 8px;\n  color: var(--ds-text-secondary-color, rgba(31, 35, 40, 0.6));\n}\n\n.4d212a29_error {\n  color: #cf222e;\n}\n";
var tagId = "@laizhixingxingdeli/dsh-coagenthub/CoAgentHubGroupList.module.css";
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="' + tagId + '"]')) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@laizhixingxingdeli/dsh-coagenthub";
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
var CoAgentHubGroupList_default = { "overlay": "d8f160b0_overlay", "panel": "5e1486db_panel", "heading": "882381d3_heading", "hint": "1c495ea2_hint", "list": "d9c9755b_list", "row": "082ccf0b_row", "title": "942eccad_title", "status": "552408ae_status", "empty": "67968ba0_empty", "error": "4d212a29_error", "loading": "55702099_loading" };

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
  (0, import_react.useEffect)(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetchGroups(apiBase).then(
      (groups) => {
        if (alive) setState({ kind: "ready", groups });
      },
      (error) => {
        if (alive) setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    );
    return () => {
      alive = false;
    };
  }, [apiBase]);
  const copyId = (id) => {
    const clipboard = navigator.clipboard;
    if (clipboard === void 0) return;
    void clipboard.writeText(id).then(() => setCopiedId(id)).catch(() => {
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: CoAgentHubGroupList_default.panel, "aria-label": "CoAgentHub \u7FA4\u5217\u8868", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: CoAgentHubGroupList_default.heading, children: "CoAgentHub \u7FA4\u5217\u8868" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: CoAgentHubGroupList_default.hint, children: "\u70B9\u51FB\u884C\u590D\u5236\u7FA4 id" }),
    state.kind === "loading" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: CoAgentHubGroupList_default.loading, children: "\u52A0\u8F7D\u4E2D\u2026" }),
    state.kind === "error" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: CoAgentHubGroupList_default.error, role: "alert", children: [
      "\u52A0\u8F7D\u5931\u8D25:",
      state.message
    ] }),
    state.kind === "ready" && state.groups.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: CoAgentHubGroupList_default.empty, children: "\u6682\u65E0\u7FA4\u7EC4" }),
    state.kind === "ready" && state.groups.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: CoAgentHubGroupList_default.list, children: state.groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: CoAgentHubGroupList_default.row,
        "data-copied": copiedId === group.id || void 0,
        onClick: () => copyId(group.id),
        title: group.id,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: CoAgentHubGroupList_default.title, children: group.title }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: CoAgentHubGroupList_default.status, "data-state": group.status, children: statusLabel(group.status) })
        ]
      }
    ) }, group.id)) })
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
