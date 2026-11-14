// Options: where Dossier is and the token it gave (Settings → Extension &
// ATS). Connecting asks Chrome for access to that one address, then checks
// the token with Dossier before keeping either.

import { ApiError, getConfig, json, originPattern, serverOrigin, TOKEN, type Ping } from "./api";
import { chrome } from "./chrome";
import { h, mark } from "./dom";

const root = document.getElementById("app")!;

const SCOPES: Record<string, string> = { "applications:read": "look up saved jobs", "applications:write": "save jobs and mark them applied", "resume:read": "download tailored PDFs" };

function status(text: string, tone: "success" | "error" | "warning" | "muted") {
  const line = document.getElementById("status")!;
  line.className = tone === "muted" ? "muted" : `notice ${tone}`;
  line.setAttribute("role", tone === "error" ? "alert" : "status");
  line.textContent = text;
}

function connectedText(ping: Ping): { text: string; tone: "success" | "warning" } {
  const can = ping.scopes.map((scope) => SCOPES[scope]).filter(Boolean);
  const missing = Object.keys(SCOPES).filter((scope) => !ping.scopes.includes(scope));
  const text = `Connected to Dossier ${ping.version}. It can ${can.join(", ")}.`;
  return missing.length ? { text: `${text} Make a new token to also ${missing.map((scope) => SCOPES[scope]).join(" and ")}.`, tone: "warning" } : { text, tone: "success" };
}

async function render() {
  const config = await getConfig();
  const server = h("input", { id: "server", name: "server", type: "url", value: config?.server ?? "", placeholder: "https://dossier.example.com", autocomplete: "url", spellcheck: "false", required: true });
  const token = h("input", { id: "token", name: "token", type: "password", value: config?.token ?? "", placeholder: "dsr_…", autocomplete: "off", spellcheck: "false", required: true });
  const connect = h("button", { class: "primary", type: "submit" }, config ? "Save and check" : "Connect");
  const form = h(
    "form",
    { class: "options", novalidate: true },
    h("div", { class: "field" }, h("label", { for: "server" }, "Dossier's address"), server, h("p", { class: "hint" }, "The address you open Dossier at.")),
    h("div", { class: "field" }, h("label", { for: "token" }, "Token"), token, h("p", { class: "hint" }, "Make one in Dossier: Settings → Extension & ATS → Make a token.")),
    h("div", { class: "actions" }, connect, config ? h("button", { class: "secondary", type: "button", onclick: () => void disconnect() }, "Disconnect") : null),
    h("p", { id: "status", class: "muted" }, config ? "Checking…" : "Not connected."),
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const origin = serverOrigin(server.value);
    const value = token.value.trim();
    if (!origin) return status("That isn't a web address. It starts with https:// (or http:// on your own network).", "error");
    if (!TOKEN.test(value)) return status("That isn't a Dossier token. It starts with dsr_ and is shown once when you make it.", "error");
    // Asked straight away, while the click still counts as one: Chrome only asks on a click.
    const granted = chrome.permissions.request({ origins: [originPattern(origin)] });
    connect.disabled = true;
    void (async () => {
      try {
        if (!(await granted)) return status(`The extension needs access to ${origin} to reach Dossier. Connect again and allow it.`, "error");
        status("Checking…", "muted");
        const ping = await json<Ping>({ server: origin, token: value }, "/ping");
        await chrome.storage.local.set({ server: origin, token: value });
        server.value = origin;
        const { text, tone } = connectedText(ping);
        status(text, tone);
      } catch (error) {
        status(error instanceof ApiError ? error.message : "Something went wrong. Try again.", "error");
      } finally {
        connect.disabled = false;
      }
    })();
  });

  root.replaceChildren(
    h("header", { class: "top" }, mark(), h("div", {}, h("p", { class: "brand" }, "Dossier"), h("p", { class: "what" }, "Extension options"))),
    h("main", {}, form, h(
        "section",
        { class: "card shortcut" },
        h("p", { class: "title" }, "Shortcut"),
        h("p", { class: "muted" }, "Alt+Shift+D opens the extension on any page."),
        // chrome:// pages open only from an extension, not from a link.
        h("div", { class: "actions" }, h("button", { class: "secondary", type: "button", onclick: () => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" }) }, "Change shortcut")),
      )),
  );

  if (config) {
    try {
      const { text, tone } = connectedText(await json<Ping>(config, "/ping"));
      status(text, tone);
    } catch (error) {
      status(error instanceof ApiError ? error.message : "Couldn't check the connection.", error instanceof ApiError && error.reconnect ? "error" : "warning");
    }
  } else server.focus();
}

async function disconnect() {
  await chrome.storage.local.remove(["server", "token"]);
  await render();
  status("Disconnected. The token still works until you revoke it in Dossier.", "muted");
}

void render();
