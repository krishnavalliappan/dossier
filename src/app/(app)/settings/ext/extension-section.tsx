"use client";

// Fork-only: Settings → Extension & ATS.

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { copyText } from "@/lib/copy-text";
import { formatShortDate } from "@/lib/dates";
import type { ExtScope } from "@/lib/ext/tokens";

import { createExtToken, revokeExtToken, saveAtsReadingOrder } from "./actions";
import { SettingsSectionIntro } from "../settings-screen";
import type { TokenRow } from "./token-row";

export type BankStatus = { bullets: number; entries: number; blocked: number };

const SCOPES: { scope: ExtScope; label: string; hint: string }[] = [
  { scope: "applications:read", label: "Look up applications", hint: "Find the application for the page you're on." },
  { scope: "applications:write", label: "Save jobs and mark them applied", hint: "Create applications from postings, start tailoring, mark Applied." },
  { scope: "resume:read", label: "Download tailored PDFs", hint: "The resume and cover letter to attach." },
];

const day = (iso: string) => formatShortDate(new Date(iso));

export function ExtensionSection({
  initial,
  bank,
  tokens: initialTokens,
  serverUrl,
}: {
  initial: { atsReadingOrder: boolean };
  bank: BankStatus;
  tokens: TokenRow[];
  serverUrl: string;
}) {
  const track = useTrackSave();
  const [atsOrder, setAtsOrder] = useState(initial.atsReadingOrder);
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("Chrome");
  const [scopes, setScopes] = useState<ExtScope[]>(SCOPES.map((entry) => entry.scope));
  const [fresh, setFresh] = useState<string | null>(null);

  const changeAtsOrder = (on: boolean) => {
    setAtsOrder(on);
    void track(saveAtsReadingOrder(on)).then((result) => {
      if (!toastResult(result).ok) setAtsOrder(!on);
    });
  };

  const create = async () => {
    const result = toastResult(await track(createExtToken({ name, scopes })));
    if (!result.ok) return;
    setFresh(result.data.token);
    setTokens(result.data.tokens);
  };

  const revoke = async (id: string) => {
    const result = toastResult(await track(revokeExtToken({ id })));
    if (result.ok) setTokens(result.data.tokens);
  };

  const copy = async (text: string, what: string) => toast((await copyText(text)) ? `${what} copied.` : `Couldn't copy it. Select the ${what.toLowerCase()} and copy it instead.`);

  return (
    <>
      <SettingsSectionIntro title="Extension & ATS">
        The Dossier browser extension saves job postings from any job board and attaches each job&apos;s tailored resume to its application form. It signs in
        with a token made here, which can only use the extension&apos;s own API.
      </SettingsSectionIntro>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-[7px]">
          <span className="text-label text-muted">Server address for the extension</span>
          <div className="flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 rounded-control border border-line-input bg-input px-3 py-2 font-mono text-[13px] [overflow-wrap:anywhere]">{serverUrl}</code>
            <Button variant="secondary" size="sm" onClick={() => void copy(serverUrl, "Address")}>
              Copy
            </Button>
          </div>
        </div>

        {fresh && (
          <div role="status" className="flex flex-col gap-2 rounded-card bg-warning-surface px-4 py-3">
            <p className="text-meta text-warning">Your new token. Copy it into the extension&apos;s options now: it won&apos;t be shown again.</p>
            <div className="flex flex-wrap items-center gap-3">
              <code className="min-w-0 flex-1 font-mono text-[13px] [overflow-wrap:anywhere]">{fresh}</code>
              <Button variant="secondary" size="sm" onClick={() => void copy(fresh, "Token")}>
                Copy token
              </Button>
              <Button variant="text" size="sm" onClick={() => setFresh(null)}>
                Done
              </Button>
            </div>
          </div>
        )}

        <h3 className="text-control font-medium">Tokens</h3>
        {tokens.length === 0 ? (
          <p className="text-sm text-muted">No tokens yet. Make one for each browser you use the extension in.</p>
        ) : (
          <ul aria-label="Extension tokens" className="flex flex-col divide-y divide-line">
            {tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {token.name} <code className="font-mono text-label text-muted">{token.prefix}…</code>
                  </span>
                  <span className="text-meta text-muted">
                    {token.valid ? "" : "No longer valid: the password changed. "}
                    Made {day(token.createdAt)} · {token.lastUsedAt ? `last used ${day(token.lastUsedAt)}` : "never used"} ·{" "}
                    {token.scopes.map((scope) => SCOPES.find((entry) => entry.scope === scope)?.label ?? scope).join(", ")}
                  </span>
                </div>
                <Button variant="text" size="sm" onClick={() => void revoke(token.id)}>
                  Revoke <span className="sr-only">{token.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}

        <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
          <legend className="sr-only">New token</legend>
          <Input label="Name" className="max-w-xs" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
          {SCOPES.map((entry) => (
            <Checkbox
              key={entry.scope}
              label={entry.label}
              hint={entry.hint}
              checked={scopes.includes(entry.scope)}
              onChange={(event) => setScopes(event.target.checked ? [...scopes, entry.scope] : scopes.filter((scope) => scope !== entry.scope))}
            />
          ))}
          <div>
            <Button onClick={() => void create()} disabled={scopes.length === 0}>
              Make a token
            </Button>
          </div>
        </fieldset>
      </Card>

      <Card padding="none" className="flex flex-col px-7 pt-1.5 pb-2.5">
        <Toggle
          className="py-4"
          label="ATS reading order"
          description="In PDFs, put your experience before the sidebar and keep section headings readable, so applicant tracking systems parse them in order. The resume looks the same."
          checked={atsOrder}
          onCheckedChange={changeAtsOrder}
        />
        <div className="flex flex-col gap-[3px] border-t border-line py-4">
          <span className="text-field">Bullet bank</span>
          <p className="text-meta text-muted" role="status">
            {bank.bullets === 0
              ? "No bullet bank imported. Run scripts/import-bank.ts with your bank to load its approved bullets."
              : `${bank.bullets} approved bullet${bank.bullets === 1 ? "" : "s"} (with variants) on ${bank.entries} role${bank.entries === 1 ? "" : "s"} or project${bank.entries === 1 ? "" : "s"}; ${bank.blocked} DO NOT CLAIM phrase${bank.blocked === 1 ? "" : "s"} guarded.`}
          </p>
        </div>
      </Card>
    </>
  );
}
