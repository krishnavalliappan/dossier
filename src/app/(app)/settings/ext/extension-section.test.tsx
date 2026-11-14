import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createExtToken, revokeExtToken, saveAtsReadingOrder } from "./actions";
import { ExtensionSection } from "./extension-section";
import type { TokenRow } from "./token-row";

const row: TokenRow = { id: "t1", name: "Chrome", prefix: "dsr_abcdef", scopes: ["applications:read", "resume:read"], createdAt: "2026-11-14T10:00:00Z", lastUsedAt: null, valid: true };

vi.mock("./actions", () => ({
  saveAtsReadingOrder: vi.fn(async () => ({ ok: true, data: null })),
  createExtToken: vi.fn(async () => ({ ok: true, data: { token: `dsr_${"x".repeat(43)}`, tokens: [row] } })),
  revokeExtToken: vi.fn(async () => ({ ok: true, data: { tokens: [] } })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("@/lib/copy-text", () => ({ copyText: vi.fn(async () => true) }));

const bank = { bullets: 0, entries: 0, blocked: 0 };

beforeEach(() => vi.clearAllMocks());

describe("Settings → Extension & ATS (fork)", () => {
  it("makes a token with the chosen permissions and shows it once", async () => {
    const user = userEvent.setup();
    render(<ExtensionSection initial={{ atsReadingOrder: false }} bank={bank} tokens={[]} serverUrl="https://dossier.example" />);
    expect(screen.getByText("https://dossier.example")).toBeInTheDocument();
    expect(screen.getByText(/No tokens yet/)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Save jobs and mark them applied" }));
    await user.click(screen.getByRole("button", { name: "Make a token" }));
    expect(createExtToken).toHaveBeenCalledWith({ name: "Chrome", scopes: ["applications:read", "resume:read"] });
    expect(screen.getByText(`dsr_${"x".repeat(43)}`)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Extension tokens" })).getByText(/Look up applications, Download tailored PDFs/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText(`dsr_${"x".repeat(43)}`)).not.toBeInTheDocument();
  });

  it("can't make a token without a permission", async () => {
    const user = userEvent.setup();
    render(<ExtensionSection initial={{ atsReadingOrder: false }} bank={bank} tokens={[]} serverUrl="https://dossier.example" />);
    for (const name of ["Look up applications", "Save jobs and mark them applied", "Download tailored PDFs"]) await user.click(screen.getByRole("checkbox", { name }));
    expect(screen.getByRole("button", { name: "Make a token" })).toBeDisabled();
  });

  it("revokes a token, flags one the password change voided, and saves ATS reading order", async () => {
    const user = userEvent.setup();
    render(<ExtensionSection initial={{ atsReadingOrder: false }} bank={{ bullets: 12, entries: 3, blocked: 2 }} tokens={[{ ...row, valid: false }]} serverUrl="https://dossier.example" />);
    expect(screen.getByText(/No longer valid: the password changed/)).toBeInTheDocument();
    expect(screen.getByText(/12 approved bullets .* on 3 roles or projects; 2 DO NOT CLAIM phrases guarded/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke Chrome" }));
    expect(revokeExtToken).toHaveBeenCalledWith({ id: "t1" });
    expect(screen.getByText(/No tokens yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "ATS reading order" }));
    expect(saveAtsReadingOrder).toHaveBeenCalledWith(true);
  });
});
