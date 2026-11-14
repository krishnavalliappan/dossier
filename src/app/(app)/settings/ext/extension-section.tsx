"use client";

// Fork-only: Settings → Extension & ATS.

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";

import { saveAtsReadingOrder } from "./actions";

export type BankStatus = { bullets: number; entries: number; blocked: number };

export function ExtensionSection({ initial, bank }: { initial: { atsReadingOrder: boolean }; bank: BankStatus }) {
  const track = useTrackSave();
  const [atsOrder, setAtsOrder] = useState(initial.atsReadingOrder);

  const changeAtsOrder = (on: boolean) => {
    setAtsOrder(on);
    void track(saveAtsReadingOrder(on)).then((result) => {
      if (!toastResult(result).ok) setAtsOrder(!on);
    });
  };

  return (
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
  );
}
