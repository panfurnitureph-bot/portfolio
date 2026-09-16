"use client";

// Header — tulad ng tunay na site: sa homepage TRANSPARENT ito at
// nakapatong sa hero slideshow (puting text, sumasabay sa kulay ng
// slide), tapos nagiging solid cream kapag nag-scroll. Sa ibang pages,
// laging solid. May hamburger menu sa mobile.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NAV_LINKS, type SiteContent } from "@/lib/products";
import { useStore } from "@/components/store";

// Ang `site` (promo banner, pangalan ng brand) ay galing sa layout — server
// ang kumukuha nito sa Supabase, hindi na ang browser.
export default function Header({ site }: { site: SiteContent }) {
  const { cartCount, wishlist } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [height, setHeight] = useState(0);
  // Mega-menu: aling nav item ang naka-hover (desktop)
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Mobile: aling nav item ang naka-expand
  const [expanded, setExpanded] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const isHome = pathname === "/";
  // Transparent lang kapag: homepage + hindi pa naka-scroll + sarado ang menus
  const transparent = isHome && !scrolled && !menuOpen && !searchOpen && !openMenu;
  const txt = transparent ? "text-cream" : "text-ink";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Sukatin ang header para sa spacer ng ibang pages
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(() => setHeight(ref.current?.offsetHeight ?? 0));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchOpen(false);
    setMenuOpen(false);
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <>
      <header
        ref={ref}
        onMouseLeave={() => setOpenMenu(null)}
        className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${
          transparent ? "bg-transparent" : "bg-cream shadow-sm"
        }`}
      >
        {/* Promo banner — laging itim; editable sa content/site.json */}
        <div className="bg-ink text-cream text-center py-1.5 px-4">
          <p className="text-xs sm:text-sm">{site.promoBanner}</p>
          <p className="text-[9px] italic text-cream/80">{site.promoBannerSmall}</p>
        </div>

        {/* Main bar: left links · logo · right icons */}
        <div className={`grid grid-cols-[auto_1fr_auto] lg:grid-cols-3 items-center px-4 sm:px-8 py-3 gap-2 ${txt}`}>
          {/* Left: spacer (desktop, para nakasentro ang logo) / hamburger (mobile) */}
          <div className="hidden lg:block" />
          <button
            className="lg:hidden p-2 justify-self-start"
            aria-label="Menu"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span className="block w-6 h-0.5 bg-current mb-1.5" />
            <span className="block w-6 h-0.5 bg-current mb-1.5" />
            <span className="block w-6 h-0.5 bg-current" />
          </button>

          {/* Center: serif logo */}
          <Link
            href="/"
            className="justify-self-center font-cormorant text-xl sm:text-[28px] font-medium tracking-[0.15em] sm:tracking-[0.25em] whitespace-nowrap"
          >
            {site.brand.name.toUpperCase()}
          </Link>

          {/* Right: search, support, account, heart, cart */}
          <div className="flex items-center justify-self-end gap-3 sm:gap-5">
            <button
              aria-label="Search"
              onClick={() => setSearchOpen(!searchOpen)}
              className="flex items-center gap-1.5 hover:text-cognac"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.5-4.5" />
              </svg>
              <span className="hidden lg:inline text-sm">Search</span>
            </button>
            <Link href="/contact" className="hidden lg:flex items-center gap-1.5 hover:text-cognac">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 16v.01M12 13a2.5 2.5 0 10-2.5-2.5" />
              </svg>
              <span className="text-sm">Support</span>
            </Link>
            <Link href="/contact" aria-label="Account" className="hidden sm:block hover:text-cognac">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
              </svg>
            </Link>
            <Link href="/wishlist" aria-label="Wishlist" className="relative hover:text-cognac">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M12 21C7 16.5 3 13 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 4.2-4 7.7-9 12.2z" />
              </svg>
              {wishlist.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-cognac text-cream text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                  {wishlist.length}
                </span>
              )}
            </Link>
            <Link href="/cart" aria-label="Cart" className="relative hover:text-cognac">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M6 7h12l1 14H5L6 7z" />
                <path d="M9 7a3 3 0 016 0" />
              </svg>
              {cartCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-cognac text-cream text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* Search bar */}
        {searchOpen && (
          <form onSubmit={submitSearch} className="px-4 sm:px-8 pb-4 bg-cream">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sofas, dining, lighting…"
              className="w-full border border-stone/40 bg-white px-4 py-3 text-sm text-ink focus:outline-none focus:border-cognac"
            />
          </form>
        )}

        {/* Desktop nav — may mega-menu sa hover */}
        <nav className={`hidden lg:flex justify-center gap-8 pb-3 text-[15px] ${txt}`}>
          {NAV_LINKS.map((link) => (
            <div key={link.href} onMouseEnter={() => setOpenMenu(link.children ? link.label : null)}>
              <Link
                href={link.href}
                onClick={() => setOpenMenu(null)}
                className={`hover:text-cognac border-b pb-0.5 transition-colors ${
                  openMenu === link.label ? "border-current" : "border-transparent hover:border-cognac"
                }`}
              >
                {link.label}
              </Link>
            </div>
          ))}
        </nav>

        {/* MEGA-MENU PANEL — subcategories kaliwa + featured image kanan */}
        {openMenu && (() => {
          const link = NAV_LINKS.find((l) => l.label === openMenu);
          if (!link?.children) return null;
          const featured = link.children.find((c) => c.href !== link.href);
          const featuredSlug = featured?.href.split("/").pop() ?? "bed";
          return (
            <div className="hidden lg:block absolute inset-x-0 top-full bg-cream border-t border-sand shadow-lg">
              <div className="max-w-6xl mx-auto grid grid-cols-[240px_1fr] gap-12 px-10 py-10">
                {/* Links column */}
                <div>
                  <p className="font-cormorant text-2xl text-ink mb-5">{link.label}</p>
                  <ul className="space-y-3">
                    {link.children.map((c) => (
                      <li key={c.href}>
                        <Link
                          href={c.href}
                          onClick={() => setOpenMenu(null)}
                          className="text-sm text-ink hover:text-cognac border-b border-transparent hover:border-cognac pb-0.5 transition-colors"
                        >
                          {c.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
                {/* Featured image */}
                <Link
                  href={link.href}
                  onClick={() => setOpenMenu(null)}
                  className="relative block h-72 overflow-hidden group bg-sand"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/images/category-${featuredSlug}.jpg`}
                    alt={link.label}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <span className="absolute bottom-3 left-4 text-cream text-sm drop-shadow">
                    {link.label} Collection
                  </span>
                </Link>
              </div>
            </div>
          );
        })()}

        {/* Mobile menu — may expandable subcategories */}
        {menuOpen && (
          <nav className="lg:hidden flex flex-col border-t border-sand bg-cream px-6 py-4 gap-1 text-ink max-h-[70vh] overflow-y-auto">
            {NAV_LINKS.map((link) => (
              <div key={link.href}>
                <div className="flex items-center justify-between">
                  <Link
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="py-2 hover:text-cognac"
                  >
                    {link.label}
                  </Link>
                  {link.children && (
                    <button
                      onClick={() => setExpanded(expanded === link.label ? null : link.label)}
                      aria-label={`Expand ${link.label}`}
                      className={`px-3 py-2 text-stone transition-transform ${
                        expanded === link.label ? "rotate-180" : ""
                      }`}
                    >
                      ⌄
                    </button>
                  )}
                </div>
                {link.children && expanded === link.label && (
                  <div className="pl-4 pb-2 flex flex-col gap-1">
                    {link.children.map((c) => (
                      <Link
                        key={c.href}
                        href={c.href}
                        onClick={() => setMenuOpen(false)}
                        className="py-1.5 text-sm text-stone hover:text-cognac"
                      >
                        {c.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="border-t border-sand pt-3 mt-2 flex flex-col gap-2 text-sm text-stone">
              <Link href="/contact" onClick={() => setMenuOpen(false)}>Support</Link>
            </div>
          </nav>
        )}
      </header>

      {/* Spacer — sa homepage 0 (hero sumisilip sa ilalim ng header),
          sa ibang pages tinutulak pababa ang content */}
      <div style={{ height: isHome ? 0 : height }} aria-hidden />
    </>
  );
}
