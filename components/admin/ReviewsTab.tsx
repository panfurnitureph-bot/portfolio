"use client";

// REVIEWS TAB — Google Reviews cards (comment + photos + date),
// Testimonials ("What our customers are saying"), and FAQs.

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { apiGet, apiPut, apiUpload, extOf, getCreds } from "./api";
import { Area, Btn, Field, ProductPicker, SaveBar, useDialogs } from "./ui";

// Auto-card uploader: pag nag-upload ng photo, awtomatikong ginagawang
// branded card (PAN logo + quote + stars) at yun ang ikinakabit.
function CardUpload({
  review,
  onChange,
}: {
  review: { name: string; rating: number; text: string; photos?: string[] };
  onChange: (photos: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const photos = review.photos ?? [];

  async function makeCard(origUrl: string): Promise<string> {
    const { user, pw } = getCreds();
    const res = await fetch("/api/admin/make-card", {
      method: "POST",
      headers: {
        "x-admin-username": user,
        "x-admin-password": pw,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        photo: origUrl,
        name: review.name,
        rating: review.rating,
        text: review.text,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Card generation failed");
    return data.url as string;
  }

  // Maramihang upload: BAWAT photo ay ginagawang branded card —
  // para iisang design lahat ng lalabas sa site.
  async function handleFiles(files: FileList) {
    if (!review.name.trim()) {
      setError("Fill in the reviewer's name first — it's printed on the card.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let current = [...photos];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const orig = await apiUpload(
          `images/reviews/upload-${Date.now()}-${i}.${extOf(f)}`,
          f
        );
        const card = await makeCard(orig);
        current = [...current, card];
      }
      onChange(current);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="mb-3">
      <span className="block text-xs font-bold text-stone mb-1">
        Photos — every upload becomes a branded card (same design)
      </span>
      <div className="flex flex-wrap items-start gap-2 mb-2">
        {photos.map((p, i) => (
          <div key={p + i} className="relative w-24 h-24 border border-sand rounded overflow-hidden shrink-0">
            <Image src={p} alt="" fill className="object-cover" sizes="96px" />
            {p.includes("/card-") && (
              <span className="absolute bottom-0 inset-x-0 bg-cognac text-cream text-[8px] text-center">CARD</span>
            )}
            <button
              onClick={() => onChange(photos.filter((_, x) => x !== i))}
              aria-label="Remove"
              className="absolute top-0 right-0 bg-red-700 text-cream w-5 h-5 text-xs leading-none"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="w-full border-2 border-dashed border-stone/40 hover:border-cognac rounded px-4 py-5 text-sm text-stone transition-colors disabled:opacity-60"
      >
        {busy
          ? "⏳ Uploading / generating cards…"
          : "📷 Upload photos (you can select several at once) — each becomes a branded card"}
      </button>
      {error && <p className="text-red-700 text-xs mt-1">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => e.target.files?.length && handleFiles(e.target.files)}
      />
    </div>
  );
}

type PendingReview = {
  id: string;
  productSlug: string;
  name: string;
  rating: number;
  text: string;
  date: string;
};

export default function ReviewsTab({
  homepage,
  setHomepage,
}: {
  homepage: any;
  setHomepage: (h: any) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState<PendingReview[]>([]);
  const { dialogs, confirmDlg, alertDlg } = useDialogs();

  // Kunin ang mga pending customer reviews (submitted mula sa website)
  async function loadPending() {
    try {
      const { user, pw } = getCreds();
      const res = await fetch("/api/reviews", {
        headers: { "x-admin-username": user, "x-admin-password": pw },
      });
      if (res.ok) setPending(await res.json());
    } catch {}
  }
  useEffect(() => {
    loadPending();
  }, []);

  async function moderate(id: string, action: "approve" | "reject") {
    try {
      const { user, pw } = getCreds();
      const res = await fetch("/api/admin/moderate-review", {
        method: "POST",
        headers: {
          "x-admin-username": user,
          "x-admin-password": pw,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setPending(pending.filter((r) => r.id !== id));
      if (action === "approve") {
        // I-refresh ang homepage state para makita agad kung site-wide review
        const fresh = await apiGet("homepage");
        setHomepage(fresh);
      }
    } catch (e) {
      await alertDlg((e as Error).message, "Moderation failed");
    }
  }

  // 🔄 Kunin ang TOTOONG reviews mula sa Google Business listing
  async function syncFromGoogle() {
    const ok = await confirmDlg(
      "This pulls your latest Google rating, review count, and the 5 most recent reviews. NEW reviews are added on top — existing reviews, photos, and cards are kept as-is.",
      "YES, SYNC",
      "Sync from Google?"
    );
    if (!ok) return;
    setSyncing(true);
    try {
      const { user, pw } = getCreds();
      const res = await fetch("/api/admin/sync-google-reviews", {
        method: "POST",
        headers: { "x-admin-username": user, "x-admin-password": pw },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      // I-reload ang homepage data para makita agad
      const fresh = await apiGet("homepage");
      setHomepage(fresh);
      await alertDlg(
        `Synced! Rating: ${data.rating} ★ · ${data.count} total reviews · ${data.added} NEW review(s) added (existing ones kept). Already saved.`,
        "✓ Google sync complete"
      );
    } catch (e) {
      await alertDlg((e as Error).message, "Sync failed");
    }
    setSyncing(false);
  }

  async function save() {
    setSaving(true);
    try {
      await apiPut("homepage", homepage);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      await alertDlg("Could not save: " + (e as Error).message, "Save failed");
    }
    setSaving(false);
  }

  const gr = homepage.googleReviews;
  function setGr(patch: any) {
    setHomepage({ ...homepage, googleReviews: { ...gr, ...patch } });
  }
  function updateReview(i: number, patch: any) {
    const items = [...gr.items];
    items[i] = { ...items[i], ...patch };
    setGr({ items });
  }

  const ts = homepage.testimonials;
  function updateTestimonial(i: number, patch: any) {
    const items = [...ts.items];
    items[i] = { ...items[i], ...patch };
    setHomepage({ ...homepage, testimonials: { ...ts, items } });
  }

  const faqs = homepage.faqs;
  function updateFaq(i: number, patch: any) {
    const items = [...faqs.items];
    items[i] = { ...items[i], ...patch };
    setHomepage({ ...homepage, faqs: { ...faqs, items } });
  }

  return (
    <div className="max-w-3xl">
      {dialogs}

      {/* ---------- PENDING CUSTOMER REVIEWS (mula sa website) ---------- */}
      <h2 className="font-bold text-lg mb-3">
        📩 Pending customer reviews{" "}
        {pending.length > 0 && (
          <span className="bg-cognac text-cream text-xs rounded-full px-2 py-0.5 align-middle">
            {pending.length}
          </span>
        )}
      </h2>
      <div className="bg-white border border-sand rounded p-5 mb-8">
        {pending.length === 0 ? (
          <p className="text-sm text-stone">
            No pending reviews. When a customer submits a review on the website, it will
            appear here for your approval before going live.
          </p>
        ) : (
          <div className="divide-y divide-sand">
            {pending.map((r) => (
              <div key={r.id} className="py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm">
                    <strong>{r.name}</strong>{" "}
                    <span className="text-olive">
                      {"★".repeat(r.rating)}
                      {"☆".repeat(5 - r.rating)}
                    </span>{" "}
                    <span className="text-xs text-stone">
                      {r.date}
                      {r.productSlug ? ` · on ${r.productSlug}` : " · site-wide"}
                    </span>
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <Btn onClick={() => moderate(r.id, "approve")} small>
                      ✓ APPROVE
                    </Btn>
                    <Btn onClick={() => moderate(r.id, "reject")} kind="danger" small>
                      ✕ REJECT
                    </Btn>
                  </div>
                </div>
                <p className="text-sm text-stone mt-2">{r.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- GOOGLE REVIEWS ---------- */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-lg">⭐ Google Reviews section</h2>
        <button
          onClick={syncFromGoogle}
          disabled={syncing}
          className="bg-[#4285F4] text-white px-4 py-2 text-xs font-bold rounded hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {syncing ? "SYNCING…" : "🔄 SYNC FROM GOOGLE"}
        </button>
      </div>
      <div className="bg-white border border-sand rounded p-5 mb-5">
        <div className="grid sm:grid-cols-3 gap-x-4">
          <Field label="Section title" value={gr.title} onChange={(v) => setGr({ title: v })} />
          <Field label="Rating (e.g. 4.9)" type="number" value={gr.rating} onChange={(v) => setGr({ rating: Number(v) || 0 })} />
          <Field label="Number of reviews" type="number" value={gr.count} onChange={(v) => setGr({ count: Number(v) || 0 })} />
        </div>
        <p className="text-xs text-stone">
          SYNC FROM GOOGLE pulls your real listing data (PAN Furniture, San Pedro) — rating,
          review count, and the 5 most relevant reviews.
        </p>
      </div>
      {gr.items.map((r: any, i: number) => (
        <div key={i} className="bg-white border border-sand rounded p-5 mb-4">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs font-bold text-stone">REVIEW #{i + 1}</p>
            <Btn
              onClick={async () => {
                if (await confirmDlg("The review from \"" + (r.name || "this customer") + "\" will be removed.", "YES, DELETE", "Delete this review?"))
                  setGr({ items: gr.items.filter((_: any, x: number) => x !== i) });
              }}
              kind="danger"
              small
            >
              DELETE
            </Btn>
          </div>
          <div className="grid sm:grid-cols-3 gap-x-4">
            <Field label="Name" value={r.name} onChange={(v) => updateReview(i, { name: v })} />
            <Field label="Stars (1-5)" type="number" value={r.rating} onChange={(v) => updateReview(i, { rating: Math.min(5, Math.max(1, Number(v) || 5)) })} />
            <Field label="Date" value={r.date} onChange={(v) => updateReview(i, { date: v })} />
          </div>
          <ProductPicker
            label="Linked product (shows product card + SHOP NOW in popup)"
            value={r.product ? [r.product] : []}
            onChange={(v) => updateReview(i, { product: v[v.length - 1] ?? "" })}
            max={1}
          />
          <Area label="Comment" value={r.text} onChange={(v) => updateReview(i, { text: v })} />
          <CardUpload review={r} onChange={(photos) => updateReview(i, { photos })} />
        </div>
      ))}
      <Btn
        onClick={() => setGr({ items: [{ name: "", rating: 5, date: "", text: "", photos: [] }, ...gr.items] })}
        kind="ghost"
      >
        + ADD REVIEW
      </Btn>

      {/* ---------- TESTIMONIALS ---------- */}
      <h2 className="font-bold text-lg mb-3 mt-10">💬 Testimonials (&quot;What our customers are saying&quot;)</h2>
      <div className="bg-white border border-sand rounded p-5 mb-4">
        <Field
          label="Section title"
          value={ts.title}
          onChange={(v) => setHomepage({ ...homepage, testimonials: { ...ts, title: v } })}
        />
        {ts.items.map((t: any, i: number) => (
          <div key={i} className="border-b border-sand pb-3 mb-3 last:border-0">
            <div className="grid sm:grid-cols-4 gap-x-4">
              <Field label="Quote" value={t.quote} onChange={(v) => updateTestimonial(i, { quote: v })} />
              <Field label="Name" value={t.name} onChange={(v) => updateTestimonial(i, { name: v })} />
              <Field label="City, State" value={t.city} onChange={(v) => updateTestimonial(i, { city: v })} />
              <div className="flex items-end gap-2 mb-3">
                <div className="flex-1">
                  <Field label="State code" value={t.state} onChange={(v) => updateTestimonial(i, { state: v.toUpperCase().slice(0, 2) })} />
                </div>
                <Btn
                  onClick={() =>
                    setHomepage({ ...homepage, testimonials: { ...ts, items: ts.items.filter((_: any, x: number) => x !== i) } })
                  }
                  kind="danger"
                  small
                >
                  ×
                </Btn>
              </div>
            </div>
          </div>
        ))}
        <Btn
          onClick={() =>
            setHomepage({
              ...homepage,
              testimonials: { ...ts, items: [...ts.items, { state: "CA", quote: "", name: "", city: "" }] },
            })
          }
          kind="ghost"
          small
        >
          + ADD TESTIMONIAL
        </Btn>
      </div>

      {/* ---------- FAQS ---------- */}
      <h2 className="font-bold text-lg mb-3 mt-10">❓ FAQs</h2>
      <div className="bg-white border border-sand rounded p-5 mb-4">
        {faqs.items.map((f: any, i: number) => (
          <div key={i} className="border-b border-sand pb-3 mb-3 last:border-0">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Field label={`Question #${i + 1}`} value={f.q} onChange={(v) => updateFaq(i, { q: v })} />
                <Area label="Answer" value={f.a} onChange={(v) => updateFaq(i, { a: v })} rows={2} />
              </div>
              <Btn
                onClick={() =>
                  setHomepage({ ...homepage, faqs: { ...faqs, items: faqs.items.filter((_: any, x: number) => x !== i) } })
                }
                kind="danger"
                small
              >
                ×
              </Btn>
            </div>
          </div>
        ))}
        <Btn
          onClick={() => setHomepage({ ...homepage, faqs: { ...faqs, items: [...faqs.items, { q: "", a: "" }] } })}
          kind="ghost"
          small
        >
          + ADD FAQ
        </Btn>
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} />
    </div>
  );
}
