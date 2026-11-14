// The toolbar badge: what the tab's page is, from its URL, and whether the
// job is already in Dossier. Only job pages at known ATSs and boards are
// looked up (never ordinary browsing), and only at the Dossier in Options.

import { classifyUrl, type PageKind } from "../../src/lib/ext/page/classify";
import { jobKey } from "../../src/lib/ext/url";
import { getConfig, json, originPattern, type Lookup } from "./api";
import { chrome, type Tab } from "./chrome";

export type Message = { type: "refresh"; tabId: number; url: string };

type Badge = { text: string; color: string; title: string };

const BADGES = {
  none: { text: "", color: "#222222", title: "Dossier" },
  list: { text: "≡", color: "#69655d", title: "Dossier: this page lists many jobs. Open one to save it." },
  new: { text: "+", color: "#222222", title: "Dossier: save this job (Alt+Shift+D)" },
  saved: { text: "✓", color: "#2f6b4a", title: "Dossier: this job is saved" },
  form: { text: "⇪", color: "#3f6aa5", title: "Dossier: this job's application form. Its resume is in Dossier." },
} satisfies Record<string, Badge>;

// A lookup per job for a minute, so switching tabs doesn't ask Dossier again.
const cache = new Map<string, { at: number; saved: boolean }>();
const CACHE_MS = 60_000;

async function isSaved(url: string): Promise<boolean | null> {
  const key = jobKey(url);
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.saved;
  const config = await getConfig();
  if (!config || !(await chrome.permissions.contains({ origins: [originPattern(config.server)] }))) return null;
  try {
    const { matches } = await json<Lookup>(config, `/applications/lookup?url=${encodeURIComponent(url)}`, { timeoutMs: 8000 });
    cache.set(key, { at: Date.now(), saved: matches.length > 0 });
    return matches.length > 0;
  } catch {
    // Dossier is down or the token is gone: the popup says which. The badge just doesn't know.
    return null;
  }
}

async function badgeFor(url: string): Promise<Badge> {
  const kind: PageKind = classifyUrl(url);
  if (kind === "none") return BADGES.none;
  if (kind === "list") return BADGES.list;
  const saved = await isSaved(url);
  if (saved) return kind === "form" ? BADGES.form : BADGES.saved;
  return BADGES.new;
}

async function show(tabId: number, url: string | undefined) {
  const badge = url ? await badgeFor(url) : BADGES.none;
  // The tab may have closed meanwhile.
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: badge.text }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color }),
    chrome.action.setBadgeTextColor({ tabId, color: "#ffffff" }),
    chrome.action.setTitle({ tabId, title: badge.title }),
  ]).catch(() => {});
}

const showTab = (tab: Tab) => (tab.id === undefined ? undefined : show(tab.id, tab.url));

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === "complete") void show(tabId, tab.url);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then(showTab, () => {});
});
chrome.runtime.onMessage.addListener((message) => {
  const refresh = message as Message;
  if (refresh?.type !== "refresh") return;
  const key = jobKey(refresh.url);
  if (key) cache.delete(key);
  void show(refresh.tabId, refresh.url);
});
// Options changed (connected, disconnected): what's saved may differ.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== "local") return;
  cache.clear();
  void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => tabs.forEach(showTab));
});
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") void chrome.runtime.openOptionsPage();
});
