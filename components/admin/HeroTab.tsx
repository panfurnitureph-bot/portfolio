"use client";

// HERO SLIDES TAB — the big slideshow at the top of the homepage.
// Each slide: headline, subtext, CTA, desktop + mobile image.
// If the headline is BLANK = image-only slide (e.g. sale GIF).

import { useState } from "react";
import { apiPut } from "./api";
import { Btn, Field, LinkSelect, SaveBar, SingleImage, useDialogs } from "./ui";

export default function HeroTab({
  homepage,
  setHomepage,
}: {
  homepage: any;
  setHomepage: (h: any) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { dialogs, confirmDlg, alertDlg } = useDialogs();
  const slides = homepage.heroSlides;

  function setSlides(s: any[]) {
    setHomepage({ ...homepage, heroSlides: s });
  }
  function update(i: number, patch: any) {
    const arr = [...slides];
    arr[i] = { ...arr[i], ...patch };
    setSlides(arr);
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= slides.length) return;
    const arr = [...slides];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setSlides(arr);
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

  return (
    <div className="max-w-3xl">
      {dialogs}
      <p className="text-sm text-stone mb-4">
        💡 If the <strong>headline is blank</strong>, only the image is shown (for promo
        images that already contain text — like the sale GIF). Slide #1 shows first.
      </p>

      {slides.map((s: any, i: number) => (
        <div key={i} className="bg-white border border-sand rounded p-5 mb-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-bold">Slide #{i + 1}</h2>
            <div className="flex gap-2">
              <Btn onClick={() => move(i, -1)} kind="ghost" small>↑</Btn>
              <Btn onClick={() => move(i, 1)} kind="ghost" small>↓</Btn>
              <Btn
                onClick={async () => {
                  if (await confirmDlg("This slide will be removed from the hero slideshow.", "YES, DELETE", "Delete this slide?"))
                    setSlides(slides.filter((_: any, x: number) => x !== i));
                }}
                kind="danger"
                small
              >
                DELETE
              </Btn>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Headline (blank = image-only)" value={s.headline} onChange={(v) => update(i, { headline: v })} />
            <Field label="Subtext" value={s.subtext} onChange={(v) => update(i, { subtext: v })} />
            <Field label="Button text (CTA)" value={s.cta} onChange={(v) => update(i, { cta: v })} />
            <LinkSelect label="Button link" value={s.ctaHref} onChange={(v) => update(i, { ctaHref: v })} />
          </div>
          <SingleImage
            label="Desktop image (wide)"
            value={s.imageDesktop}
            onChange={(v) => update(i, { imageDesktop: v })}
            uploadDir="images"
            baseName={`hero-slide-${i + 1}-desktop`}
            hint="Recommended: 2400×1300 (wide, 1.85:1)"
          />
          <SingleImage
            label="Mobile image (portrait)"
            value={s.imageMobile}
            onChange={(v) => update(i, { imageMobile: v })}
            uploadDir="images"
            baseName={`hero-slide-${i + 1}-mobile`}
            hint="Recommended: 1200×1500 (portrait, 4:5)"
          />
        </div>
      ))}

      <Btn
        onClick={() =>
          setSlides([
            ...slides,
            { headline: "New slide", subtext: "", cta: "Shop Now", ctaHref: "/", imageDesktop: "", imageMobile: "" },
          ])
        }
        kind="ghost"
      >
        + ADD SLIDE
      </Btn>

      <SaveBar onSave={save} saving={saving} saved={saved} />
    </div>
  );
}
