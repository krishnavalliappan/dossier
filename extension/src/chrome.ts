// The parts of Chrome's extension API this extension uses, typed here rather
// than with @types/chrome (no new dependency for the app). Promise-based, as
// MV3's APIs are.

export type Tab = { id?: number; url?: string; active?: boolean; windowId?: number; status?: string };

type Event<Listener> = { addListener(listener: Listener): void };

export type ChromeApi = {
  runtime: {
    getURL(path: string): string;
    getManifest(): { version: string; name: string };
    openOptionsPage(): Promise<void>;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: Event<(message: unknown, sender: unknown, reply: (answer: unknown) => void) => boolean | void>;
    onInstalled: Event<(details: { reason: string }) => void>;
  };
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
    onChanged: Event<(changes: Record<string, { newValue?: unknown }>, area: string) => void>;
  };
  tabs: {
    query(query: { active: boolean; lastFocusedWindow?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
    get(tabId: number): Promise<Tab>;
    create(properties: { url: string; active?: boolean }): Promise<Tab>;
    onUpdated: Event<(tabId: number, change: { url?: string; status?: string }, tab: Tab) => void>;
    onActivated: Event<(info: { tabId: number }) => void>;
  };
  scripting: {
    executeScript<Args extends unknown[], T>(injection: {
      target: { tabId: number; frameIds?: number[]; allFrames?: boolean };
      func: (...args: Args) => T;
      args?: Args;
      world?: "ISOLATED" | "MAIN";
    }): Promise<{ frameId: number; result?: T }[]>;
  };
  action: {
    setBadgeText(details: { tabId?: number; text: string }): Promise<void>;
    setBadgeBackgroundColor(details: { tabId?: number; color: string }): Promise<void>;
    setBadgeTextColor(details: { tabId?: number; color: string }): Promise<void>;
    setTitle(details: { tabId?: number; title: string }): Promise<void>;
  };
  permissions: {
    request(permissions: { origins: string[] }): Promise<boolean>;
    contains(permissions: { origins: string[] }): Promise<boolean>;
  };
};

export const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
