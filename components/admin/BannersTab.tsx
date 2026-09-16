"use client";

// BANNERS TAB — inset banner slideshows ("Made in America" etc.)
// + the 3 split sections (Outdoor / Armchairs / Dining).

import { useState } from "react";
import { apiPut } from "./api";
import { Btn, Field, LinkSelect, ProductPicker, SaveBar, SingleImage, useDialogs } from "./ui";

export default function BannersTab({
  homepage,
  setHomepage,
}: {
  homepage: any;
  setHomepage: (h: any) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { dialogs, confirmDlg, alertDlg } = useDialogs();

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

  function updateBannerSlide(bi: number, si: number, patch: any) {
    const banners = [...homepage.bannerSlideshows];
    const slides = [...banners[bi].slides];
    slides[si] = { ...slides[si], ...patch };
    banners[bi] = { ...banners[bi], slides };
    setHomepage({ ...homepage, bannerSlideshows: banners });
  }

  function updateSplit(i: number, patch: any) {
    const arr = [...homepage.splitSections];
    arr[i] = { ...arr[i], ...patch };
    setHomepage({ ...homepage, splitSections: arr });
  }

  return (
    <div className="max-w-3xl">
      {dialogs}
      <h2 className="font-bold text-lg mb-3">🎞️ Banner Slideshows</h2>
      {homepage.bannerSlideshows.map((banner: any, bi: number) => (
        <div key={banner.id} className="bg-white border border-sand rounded p-5 mb-5">
          <h3 className="font-bold mb-3 uppercase text-sm tracking-wide">{banner.id}</h3>
          {banner.slides.map((s: any, si: number) => (
            <div key={si} className="border-b border-sand pb-4 mb-4 last:border-0">
              <div className="flex justify-between items-center mb-2">
                <p className="text-xs font-bold text-stone">SLIDE {si + 1}</p>
                <Btn
                  onClick={async () => {
                    if (!(await confirmDlg("This slide will be removed from the banner.", "YES, DELETE", "Delete this slide?"))) return;
                    const banners = [...homepage.bannerSlideshows];
                    banners[bi] = { ...banners[bi], slides: banners[bi].slides.filter((_: any, x: number) => x !== si) };
                    setHomepage({ ...homepage, bannerSlideshows: banners });
                  }}
                  kind="danger"
                  small
                >
                  ×
                </Btn>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-4">
                <Field label="Headline" value={s.headline} onChange={(v) => updateBannerSlide(bi, si, { headline: v })} />
                <Field label="Label (bottom-right)" value={s.label} onChange={(v) => updateBannerSlide(bi, si, { label: v })} />
              </div>
              {s.ctas.map((c: any, ci: number) => (
                <div key={ci} className="grid sm:grid-cols-2 gap-x-4">
                  <Field
                    label={`Button ${ci + 1} — text`}
                    value={c.label}
                    onChange={(v) => {
                      const ctas = [...s.ctas];
                      ctas[ci] = { ...ctas[ci], label: v };
                      updateBannerSlide(bi, si, { ctas });
                    }}
                  />
                  <LinkSelect
                    label={`Button ${ci + 1} — link`}
                    value={c.href}
                    onChange={(v) => {
                      const ctas = [...s.ctas];
                      ctas[ci] = { ...ctas[ci], href: v };
                      updateBannerSlide(bi, si, { ctas });
                    }}
                  />
                </div>
              ))}
              <SingleImage
                label="Image"
                value={s.image}
                onChange={(v) => updateBannerSlide(bi, si, { image: v })}
                uploadDir="images"
                baseName={`banner-${banner.id}-${si + 1}`}
                hint="Recommended: 2520×1080 (wide landscape, 21:9)"
              />
            </div>
          ))}
          <Btn
            onClick={() => {
              const banners = [...homepage.bannerSlideshows];
              banners[bi] = {
                ...banners[bi],
                slides: [...banners[bi].slides, { headline: "New slide", ctas: [{ label: "Shop Now", href: "/" }], image: "", label: "" }],
              };
              setHomepage({ ...homepage, bannerSlideshows: banners });
            }}
            kind="ghost"
            small
          >
            + ADD SLIDE
          </Btn>
        </div>
      ))}

      <h2 className="font-bold text-lg mb-3 mt-8">🔀 Split Sections (banner + 3 products)</h2>
      {homepage.splitSections.map((s: any, i: number) => (
        <div key={i} className="bg-white border border-sand rounded p-5 mb-5">
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Headline" value={s.headline} onChange={(v) => updateSplit(i, { headline: v })} />
            <Field label="Subtext" value={s.subtext} onChange={(v) => updateSplit(i, { subtext: v })} />
            <Field label="Button text" value={s.cta} onChange={(v) => updateSplit(i, { cta: v })} />
            <LinkSelect label="Button link" value={s.href} onChange={(v) => updateSplit(i, { href: v })} />
          </div>
          <SingleImage
            label="Banner image"
            value={s.image}
            onChange={(v) => updateSplit(i, { image: v })}
            uploadDir="images"
            baseName={`split-${i + 1}`}
            hint="Recommended: 1200×960 (portrait tile, 5:4)"
          />
          <ProductPicker
            label="3 products na ipapakita"
            value={s.productPrefixes}
            onChange={(v) => updateSplit(i, { productPrefixes: v })}
            max={3}
          />
        </div>
      ))}

      <div className="bg-white border border-sand rounded p-5 mb-5">
        <h2 className="font-bold mb-3">🛋️ &quot;Best-selling sofas&quot; carousel</h2>
        <Field
          label="Section title"
          value={homepage.bestSelling.title}
          onChange={(v) => setHomepage({ ...homepage, bestSelling: { ...homepage.bestSelling, title: v } })}
        />
        <ProductPicker
          label="Products sa carousel"
          value={homepage.bestSelling.productPrefixes}
          onChange={(v) =>
            setHomepage({ ...homepage, bestSelling: { ...homepage.bestSelling, productPrefixes: v } })
          }
        />
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} />
    </div>
  );
}
