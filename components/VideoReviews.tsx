"use client";

// "Sit back and press play" — video review cards na may totoong
// HTML5 video player (play/pause, mute, progress), poster thumbnails.

import { useRef, useState } from "react";
import Carousel from "@/components/Carousel";
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
    <div className="snap-start shrink-0 w-[70vw] sm:w-[300px]">
      <div className="relative aspect-[9/14] bg-sand overflow-hidden">
        <video
          ref={ref}
          src={video}
          poster={poster}
          muted={muted}
          playsInline
          loop
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
  return (
    <Carousel title={title} eyebrow={eyebrow}>
      {items
        .filter((v) => v.video) // laktawan ang mga walang video file
        .map((v, i) => (
          <VideoCard key={v.name + i} {...v} />
        ))}
    </Carousel>
  );
}
