"use client";

// VIDEOS TAB — "Sit back and press play" section (video reviews) +
// UGC section titles.

import { useRef, useState } from "react";
import { apiPut, apiUpload, extOf } from "./api";
import { Area, Btn, Field, ImageList, SaveBar, SingleImage, useDialogs } from "./ui";

function VideoUpload({
  value,
  onChange,
  index,
}: {
  value: string;
  onChange: (v: string) => void;
  index: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(f: File) {
    if (f.size > 60 * 1024 * 1024) {
      setError("Video is too large (max 60MB). Please compress it first.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const url = await apiUpload(`videos/review-custom-${index}-${Date.now()}.${extOf(f)}`, f);
      onChange(url);
    } catch (e) {
      setError("Upload failed: " + (e as Error).message);
    }
    setUploading(false);
  }

  return (
    <div className="mb-3">
      <span className="block text-xs font-bold text-stone mb-1">Video file (.mp4)</span>
      <div className="flex items-center gap-3">
        <button
          onClick={() => inputRef.current?.click()}
          className="border border-stone/40 hover:border-cognac px-3 py-1.5 text-xs font-bold rounded"
        >
          {uploading ? "UPLOADING... (this takes a while)" : "REPLACE VIDEO"}
        </button>
        <span className="text-xs text-stone truncate max-w-[240px]">{value}</span>
      </div>
      {error && <p className="text-red-700 text-xs mt-1">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm"
        hidden
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </div>
  );
}

export default function VideosTab({
  homepage,
  setHomepage,
}: {
  homepage: any;
  setHomepage: (h: any) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { dialogs, confirmDlg, alertDlg } = useDialogs();
  const vr = homepage.videoReviews;

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

  function setVr(patch: any) {
    setHomepage({ ...homepage, videoReviews: { ...vr, ...patch } });
  }
  function updateItem(i: number, patch: any) {
    const items = [...vr.items];
    items[i] = { ...items[i], ...patch };
    setVr({ items });
  }

  return (
    <div className="max-w-3xl">
      {dialogs}
      <div className="bg-white border border-sand rounded p-5 mb-5">
        <h2 className="font-bold mb-3">🎬 &quot;Sit back and press play&quot; section</h2>
        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label="Eyebrow (small text above title)" value={vr.eyebrow} onChange={(v) => setVr({ eyebrow: v })} />
          <Field label="Section title" value={vr.title} onChange={(v) => setVr({ title: v })} />
        </div>
      </div>

      {vr.items.map((item: any, i: number) => (
        <div key={i} className="bg-white border border-sand rounded p-5 mb-4">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs font-bold text-stone">VIDEO #{i + 1}</p>
            <Btn
              onClick={async () => {
                if (await confirmDlg("Video #" + (i + 1) + " will be removed from the section.", "YES, DELETE", "Delete this video?"))
                  setVr({ items: vr.items.filter((_: any, x: number) => x !== i) });
              }}
              kind="danger"
              small
            >
              DELETE
            </Btn>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Name" value={item.name} onChange={(v) => updateItem(i, { name: v })} />
            <Field label="Role (e.g. Real Customer)" value={item.role} onChange={(v) => updateItem(i, { role: v })} />
          </div>
          <VideoUpload value={item.video} onChange={(v) => updateItem(i, { video: v })} index={i + 1} />
          <SingleImage
            label="Poster / thumbnail (before play)"
            value={item.poster}
            onChange={(v) => updateItem(i, { poster: v })}
            uploadDir="images"
            baseName={`video-poster-custom-${i + 1}`}
            hint="Recommended: 900×1400 (vertical, 9:14)"
          />
        </div>
      ))}
      <Btn
        onClick={() => setVr({ items: [...vr.items, { video: "", poster: "", name: "", role: "Real Customer" }] })}
        kind="ghost"
      >
        + ADD VIDEO
      </Btn>

      <div className="bg-white border border-sand rounded p-5 my-5">
        <h2 className="font-bold mb-3">📸 UGC section (&quot;in real life&quot;)</h2>
        <Field
          label="Title"
          value={homepage.ugc.title}
          onChange={(v) => setHomepage({ ...homepage, ugc: { ...homepage.ugc, title: v } })}
        />
        <Field
          label="Subtitle (hashtag line)"
          value={homepage.ugc.subtitle}
          onChange={(v) => setHomepage({ ...homepage, ugc: { ...homepage.ugc, subtitle: v } })}
        />
        <Field
          label="Handle (shown in photo popup)"
          value={homepage.ugc.handle ?? "@panfurnitures"}
          onChange={(v) => setHomepage({ ...homepage, ugc: { ...homepage.ugc, handle: v } })}
        />
        <Area
          label="Popup caption"
          value={homepage.ugc.caption ?? ""}
          onChange={(v) => setHomepage({ ...homepage, ugc: { ...homepage.ugc, caption: v } })}
          rows={3}
        />
        <ImageList
          images={homepage.ugc.photos ?? []}
          onChange={(imgs) => setHomepage({ ...homepage, ugc: { ...homepage.ugc, photos: imgs } })}
          uploadDir="images/ugc"
          baseName="ugc"
          unique
        />
        <p className="text-xs text-stone">
          These are the photos in the &quot;in real life&quot; grid — drag in photos from
          your FB posts. When empty, product photos are shown instead.
        </p>
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} />
    </div>
  );
}
