"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncFbContacts } from "@/app/orders/fb-actions";

// Pulls ALL of the Page's Messenger conversations into fb_contacts so every customer
// who ever messaged shows up in the Create Order picker. Re-runnable; the webhook keeps
// it fresh afterwards, so this is mainly for the initial import.
export function FbSyncButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  function run() {
    setMsg(null);
    start(async () => {
      const r = await syncFbContacts();
      if ("error" in r) { setMsg(r.error); return; }
      // Ang inbox ay 30,000+ thread, kaya ang isang run ay may 40s na budget at
      // umaabot lang sa parte nito — ang `more` ang nagsasabing may natitira pa,
      // at ang muling pindot ang nagpapatuloy (upsert = walang duplicate).
      //
      // Ipinapakita ang KABUUAN dahil ang sync ay sumusulong pa-LUMA (resume
      // cursor) samantalang ang picker ay nag-uuna ng PINAKABAGO — kaya ang mga
      // kaka-import ay hindi agad kita sa itaas ng listahan at mukhang "walang
      // nangyari". Ang bilang ng kabuuan ang tunay na sukatan ng progreso.
      const base = `+${r.synced} imported · ${r.total.toLocaleString()} customers total`;
      setMsg(r.more ? `${base} — tap again for older ones.` : `${base}. All imported.`);
      router.refresh();
    });
  }

  return (
    <div className="apk-hide relative">
      <button
        onClick={run}
        disabled={pending}
        title="Import every customer who messaged the Facebook Page"
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-60"
      >
        {pending ? "Syncing…" : "⟳ Sync FB customers"}
      </button>
      {msg && (
        <span className="absolute left-0 top-full mt-1 whitespace-nowrap rounded-md bg-stone-800 px-2 py-1 text-xs text-white shadow-lg">
          {msg}
        </span>
      )}
    </div>
  );
}
