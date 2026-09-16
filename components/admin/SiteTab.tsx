"use client";

// PROMO & SITE TAB — promo banner (2 lines), brand, contact info,
// trust badges, "Featured in" quote.

import { useState } from "react";
import { apiPut } from "./api";
import { Field, SaveBar, useDialogs } from "./ui";

export default function SiteTab({
  site,
  setSite,
  homepage,
  setHomepage,
}: {
  site: any;
  setSite: (s: any) => void;
  homepage: any;
  setHomepage: (h: any) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { dialogs, alertDlg } = useDialogs();

  async function save() {
    setSaving(true);
    try {
      await apiPut("site", site);
      await apiPut("homepage", homepage);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      await alertDlg("Could not save: " + (e as Error).message, "Save failed");
    }
    setSaving(false);
  }

  function badge(i: number, patch: any) {
    const items = [...homepage.trustBadges];
    items[i] = { ...items[i], ...patch };
    setHomepage({ ...homepage, trustBadges: items });
  }

  // ---- Shipping rates (province -> city -> fee) ----
  const provinces: any[] = site.shipping?.provinces ?? [];
  function setProvinces(next: any[]) {
    setSite({ ...site, shipping: { ...(site.shipping ?? {}), provinces: next } });
  }
  function updCity(pi: number, ci: number, patch: any) {
    const next = provinces.map((p) => ({ ...p, cities: [...p.cities] }));
    next[pi].cities[ci] = { ...next[pi].cities[ci], ...patch };
    setProvinces(next);
  }
  function addCity(pi: number) {
    const next = provinces.map((p) => ({ ...p, cities: [...p.cities] }));
    next[pi].cities.push({ name: "New city", fee: 0 });
    setProvinces(next);
  }
  function delCity(pi: number, ci: number) {
    const next = provinces.map((p) => ({ ...p, cities: [...p.cities] }));
    next[pi].cities.splice(ci, 1);
    setProvinces(next);
  }
  function addProvince() {
    setProvinces([...provinces, { name: "New province", cities: [] }]);
  }
  function updProvinceName(pi: number, name: string) {
    const next = provinces.map((p) => ({ ...p }));
    next[pi] = { ...next[pi], name };
    setProvinces(next);
  }
  function delProvince(pi: number) {
    setProvinces(provinces.filter((_, i) => i !== pi));
  }

  return (
    <div className="max-w-3xl">
      {dialogs}
      <div className="bg-white border border-sand rounded p-5 mb-5">
        <h2 className="font-bold mb-4">📢 Promo Banner (black strip at the very top)</h2>
        <Field
          label="Main line"
          value={site.promoBanner}
          onChange={(v) => setSite({ ...site, promoBanner: v })}
        />
        <Field
          label="Small line (exclusions)"
          value={site.promoBannerSmall}
          onChange={(v) => setSite({ ...site, promoBannerSmall: v })}
        />
      </div>

      {/* Promo code discount sa product pages ("or ₱X with code SUMMER") */}
      <div className="bg-white border border-sand rounded p-5 mb-5">
        <h2 className="font-bold mb-4">🏷️ Promo Code Discount (sa product pages)</h2>
        <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={site.promo?.enabled ?? false}
            onChange={(e) =>
              setSite({ ...site, promo: { ...(site.promo ?? { code: "", rate: 0 }), enabled: e.target.checked } })
            }
            className="accent-cognac"
          />
          <span className="font-bold">Show &quot;or ₱X with code&quot; on product pages</span>
        </label>
        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field
            label="Promo code (e.g. SUMMER)"
            value={site.promo?.code ?? ""}
            onChange={(v) => setSite({ ...site, promo: { ...(site.promo ?? { enabled: false, rate: 0 }), code: v } })}
          />
          <Field
            label="Discount %"
            type="number"
            value={site.promo?.rate ?? 0}
            onChange={(v) => setSite({ ...site, promo: { ...(site.promo ?? { enabled: false, code: "" }), rate: Number(v) || 0 } })}
          />
        </div>
        <p className="text-xs text-stone">
          Uncheck to remove the promo line from all products. This does not affect the
          promo banner at the top (that&apos;s set separately above).
        </p>
      </div>

      {/* Shipping fee per lokasyon (province -> city) */}
      <div className="bg-white border border-sand rounded p-5 mb-5">
        <h2 className="font-bold mb-1">🚚 Shipping Fee per Location</h2>
        <p className="text-xs text-stone mb-4">
          At checkout, the customer picks a province and city — the shipping fee and
          total appear automatically. Edit the amounts here.
        </p>
        {provinces.map((prov: any, pi: number) => (
          <div key={pi} className="border border-sand rounded mb-3">
            <div className="flex items-center gap-2 bg-sand/40 px-3 py-2">
              <input
                value={prov.name}
                onChange={(e) => updProvinceName(pi, e.target.value)}
                className="font-bold text-sm bg-transparent flex-1 focus:outline-none"
              />
              <span className="text-xs text-stone">{prov.cities.length} cities</span>
              <button onClick={() => delProvince(pi)} className="text-xs text-red-700 hover:text-red-900 font-bold">
                ✕ remove
              </button>
            </div>
            <div className="p-2 space-y-1">
              {prov.cities.map((c: any, ci: number) => (
                <div key={ci} className="flex items-center gap-2">
                  <input
                    value={c.name}
                    onChange={(e) => updCity(pi, ci, { name: e.target.value })}
                    className="flex-1 border border-stone/30 rounded px-2 py-1 text-sm focus:outline-none focus:border-cognac"
                  />
                  <span className="text-stone text-sm">₱</span>
                  <input
                    type="number"
                    value={c.fee}
                    onChange={(e) => updCity(pi, ci, { fee: Number(e.target.value) || 0 })}
                    className="w-24 border border-stone/30 rounded px-2 py-1 text-sm focus:outline-none focus:border-cognac"
                  />
                  <button onClick={() => delCity(pi, ci)} className="text-red-600 hover:text-red-800 text-lg leading-none px-1">
                    ×
                  </button>
                </div>
              ))}
              <button onClick={() => addCity(pi)} className="text-xs text-cognac hover:text-ink font-bold mt-1">
                + add city
              </button>
            </div>
          </div>
        ))}
        <button onClick={addProvince} className="text-sm bg-sand hover:bg-stone/20 px-3 py-2 rounded font-bold">
          + add province
        </button>
      </div>

      <div className="bg-white border border-sand rounded p-5 mb-5">
        <h2 className="font-bold mb-4">🏷️ Brand</h2>
        <Field
          label="Brand name (logo text)"
          value={site.brand.name}
          onChange={(v) => setSite({ ...site, brand: { ...site.brand, name: v } })}
        />
      </div>

      <div className="bg-white border border-sand rounded p-5 mb-5">
        <h2 className="font-bold mb-4">☎️ Contact (pre-footer + contact page + chat bubble)</h2>
        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label="Email" value={site.contact.email} onChange={(v) => setSite({ ...site, contact: { ...site.contact, email: v } })} />
          <Field label="Phone" value={site.contact.phone} onChange={(v) => setSite({ ...site, contact: { ...site.contact, phone: v } })} />
          <Field label="Hours" value={site.contact.hours} onChange={(v) => setSite({ ...site, contact: { ...site.contact, hours: v } })} />
        </div>
      </div>

      <div className="bg-white border border-sand rounded p-5 mb-5">
        <h2 className="font-bold mb-4">🛡️ Trust Badges (below the hero)</h2>
        {homepage.trustBadges.map((b: any, i: number) => (
          <div key={i} className="grid sm:grid-cols-2 gap-x-4 border-b border-sand pb-2 mb-3 last:border-0">
            <Field label={`Badge ${i + 1} — title`} value={b.title} onChange={(v) => badge(i, { title: v })} />
            <Field label="Second line (can be blank)" value={b.text} onChange={(v) => badge(i, { text: v })} />
          </div>
        ))}
      </div>

      <div className="bg-white border border-sand rounded p-5 mb-5">
        <h2 className="font-bold mb-4">📰 &quot;Featured in&quot; section</h2>
        <Field
          label="Quote (italic serif)"
          value={homepage.pressBar.quote}
          onChange={(v) => setHomepage({ ...homepage, pressBar: { ...homepage.pressBar, quote: v } })}
        />
        <Field
          label="Press logos (separate with commas)"
          value={homepage.pressBar.logos.join(", ")}
          onChange={(v) =>
            setHomepage({
              ...homepage,
              pressBar: { ...homepage.pressBar, logos: v.split(",").map((s) => s.trim()).filter(Boolean) },
            })
          }
        />
      </div>

      <div className="bg-white border border-sand rounded p-5 mb-5">
        <h2 className="font-bold mb-4">💬 Pre-footer (&quot;Any questions?&quot;)</h2>
        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label="Title" value={homepage.preFooter.title} onChange={(v) => setHomepage({ ...homepage, preFooter: { ...homepage.preFooter, title: v } })} />
          <Field label="Subtitle" value={homepage.preFooter.subtitle} onChange={(v) => setHomepage({ ...homepage, preFooter: { ...homepage.preFooter, subtitle: v } })} />
          <Field label="Phone" value={homepage.preFooter.phone} onChange={(v) => setHomepage({ ...homepage, preFooter: { ...homepage.preFooter, phone: v } })} />
          <Field label="Phone hours" value={homepage.preFooter.phoneHours} onChange={(v) => setHomepage({ ...homepage, preFooter: { ...homepage.preFooter, phoneHours: v } })} />
          <Field label="Email" value={homepage.preFooter.email} onChange={(v) => setHomepage({ ...homepage, preFooter: { ...homepage.preFooter, email: v } })} />
          <Field label="Email note" value={homepage.preFooter.emailText} onChange={(v) => setHomepage({ ...homepage, preFooter: { ...homepage.preFooter, emailText: v } })} />
        </div>
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} />
    </div>
  );
}
