"use client";

// Header — tulad ng tunay na site: sa homepage TRANSPARENT ito at
// nakapatong sa hero slideshow (puting text, sumasabay sa kulay ng
// slide), tapos nagiging solid cream kapag nag-scroll. Sa ibang pages,
// laging solid. May hamburger menu sa mobile.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NAV_LINKS, type NavLink, type SiteContent } from "@/lib/products";
import { useStore } from "@/components/store";

// Ang `site` (promo banner, pangalan ng brand) ay galing sa layout — server
// ang kumukuha nito sa Supabase, hindi na ang browser.
// `nav` ay ipinapasa ng layout (server) — doon na-sync ang categories mula sa
// IMS; sa browser ay static lang ang NAV_LINKS kaya prop ang ginagamit.
export default function Header({ site, nav = NAV_LINKS }: { site: SiteContent; nav?: NavLink[] }) {
  const { cartCount, quoteCount } = useStore();
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
        data-site-header=""
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
        <div className={`hdr-txt grid grid-cols-[auto_1fr_auto] lg:grid-cols-3 items-center px-4 sm:px-8 py-3 gap-2 ${txt}`}>
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
            className="justify-self-center font-cormorant text-xl sm:text-[26px] font-normal tracking-[0.1em] sm:tracking-[0.16em] whitespace-nowrap"
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
            {/* HEADER ICONS (2026-09-04): Search · Quotation · Cart lang. Tanggal ang
                Support, Account at wishlist na icon — ang heart sa cards ay gumagana
                pa rin at nasa /wishlist ang listahan. Ang Quotation ay laging kita
                (dating lumalabas lang kapag may laman). */}
            <Link href="/quote-request" aria-label={`Quotation (${quoteCount})`} className="relative flex items-center gap-1.5 hover:text-cognac">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M8 4h8a2 2 0 012 2v14l-6-3-6 3V6a2 2 0 012-2z" />
                <path d="M9 9h6M9 12.5h4" />
              </svg>
              <span className="hidden lg:inline text-sm">Quotation</span>
              {quoteCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-cognac text-cream text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                  {quoteCount}
                </span>
              )}
            </Link>
            <Link href="/cart" aria-label="Cart" className="relative flex items-center gap-1.5 hover:text-cognac">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M6 7h12l1 14H5L6 7z" />
                <path d="M9 7a3 3 0 016 0" />
              </svg>
              <span className="hidden lg:inline text-sm">Cart</span>
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
        <nav className={`hdr-txt hidden lg:flex justify-center gap-8 pb-3 text-[15px] ${txt}`}>
          {nav.map((link) => (
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
          const link = nav.find((l) => l.label === openMenu);
          if (!link?.children) return null;
          const featured = link.children.find((c) => c.href !== link.href);
          const featuredSlug = featured?.href.split("/").pop() ?? "bed";
          // ANG LARAWAN AY MULA SA IMS (2026-08-26) — Website > Promo & Site >
          // Menu Images. Dati ay naka-fix sa file ng UNANG subcategory, kaya ang
          // "Living" ay nagpapakita ng litrato ng Side Table at ang pagpapalit
          // ay nangangailangan ng deploy. Panakip pa rin ang lumang file kapag
          // walang naka-upload.
          const menuImg = site.menuImages?.[openMenu.toLowerCase()] || `/store/images/category-${featuredSlug}.jpg`;
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
                  className="relative block h-72 overflow-hidden group bg-white"
                >
                  {/* BUONG LITRATO (2026-09-04, "putol mga image dapat auto fit"):
                      ang mga product shot ay puting canvas na iba-iba ang hugis -
                      ang cover crop ay pinuputol ang upuan. Contain + padding,
                      at ang label ay nasa madilim na banda sa ibaba para
                      laging kita kahit puti ang litrato. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={menuImg}
                    alt={link.label}
                    className="w-full h-full object-contain p-4 pb-10 group-hover:scale-105 transition-transform duration-500"
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-ink/0 px-4 pb-3 pt-8 text-sm text-cream">
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
            {nav.map((link) => (
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
