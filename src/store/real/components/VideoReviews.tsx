"use client";

// "Sit back and press play" — video review cards na may totoong
// HTML5 video player (play/pause, mute, progress), poster thumbnails.

import { useRef, useState } from "react";
import Marquee from "@/components/home/Marquee";
import type { HomepageContent } from "@/lib/products";

function VideoCard({
  video,
  poster,
  name,
  role,
}: {
  video: string;
  poster: string;
  name: string;
  role: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  // Ang isang slot ay pwedeng larawan O video. Kung larawan, ipapakita ito
  // bilang still na larawan — walang player.
  const isImage = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(video);

  function toggle() {
    const v = ref.current;
    if (!v || !video) return; // walang source — huwag mag-play (iwas NotSupportedError)
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  return (
    <div className="snap-center shrink-0 w-[70vw] sm:w-[300px]">
      <div className="relative aspect-[9/14] bg-sand overflow-hidden">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video} alt={name || "Customer photo"} className="w-full h-full object-cover" />
        ) : (
          <>
            <video
              ref={ref}
              src={video}
              poster={poster}
              muted={muted}
              playsInline
              loop
              // Huwag i-download ang video hangga't hindi pinipindot ang play —
              // ang poster ang nakikita. May 32MB na video review dati na
              // bumabagal sa buong page load ng mobile.
              preload="none"
              className="w-full h-full object-cover"
              onClick={toggle}
            />
            {/* Controls */}
            <div className="absolute bottom-3 left-3 flex items-center gap-2">
              <button
                onClick={toggle}
                aria-label={playing ? "Pause" : "Play"}
                className="w-9 h-9 rounded-full bg-cream/90 text-ink flex items-center justify-center text-sm"
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <button
                onClick={() => {
                  setMuted(!muted);
                  if (ref.current) ref.current.muted = !muted;
                }}
                aria-label={muted ? "Unmute" : "Mute"}
                className="w-9 h-9 rounded-full bg-cream/90 text-ink flex items-center justify-center text-sm"
              >
                {muted ? "🔇" : "🔊"}
              </button>
            </div>
          </>
        )}
      </div>
      <p className="font-bold text-sm mt-4">{name}</p>
      <p className="text-stone text-sm">{role}</p>
    </div>
  );
}

// Galing sa homepage (server) — doon nabasa ang Supabase content.
export default function VideoReviews({
  videoReviews,
}: {
  videoReviews: HomepageContent["videoReviews"];
}) {
  const { eyebrow, title, items } = videoReviews;
  if (!items.some((v) => v.video)) return null; // demo catalog ships no video files
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-8 py-12 md:py-14">
      {/* RAIL (2026-09-04): parehong carousel engine ng buong homepage */}
      <Marquee eyebrow={eyebrow} title={title} n={[4, 3, 2, 2]}>
        {items
          .filter((v) => v.video) // laktawan ang mga walang video file
          .map((v, i) => (
            <VideoCard key={v.name + i} {...v} />
          ))}
      </Marquee>
    </section>
  );
}
