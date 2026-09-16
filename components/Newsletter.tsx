"use client";

// Newsletter signup form. Wala pang backend — nagpapakita lang ng
// success message. Ikonekta sa Mailchimp/Klaviyo/etc. kapag handa na.

import { useState } from "react";

export default function Newsletter({ dark = false }: { dark?: boolean }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) return;
    setDone(true);
  }

  if (done) {
    return (
      <p className={`text-sm ${dark ? "text-cognac" : "text-cognac"}`}>
        ✓ Thank you! You&apos;re on the list — welcome to the family.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex gap-0">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email address"
        className={`flex-1 px-4 py-3 text-sm focus:outline-none ${
          dark
            ? "bg-cream/10 border border-cream/30 text-cream placeholder:text-cream/50 focus:border-cognac"
            : "bg-white border border-stone/40 text-ink focus:border-cognac"
        }`}
      />
      <button
        type="submit"
        className="bg-cognac text-cream px-6 py-3 text-sm font-bold tracking-widest2 hover:bg-cognac/90 transition-colors"
      >
        SIGN UP
      </button>
    </form>
  );
}
