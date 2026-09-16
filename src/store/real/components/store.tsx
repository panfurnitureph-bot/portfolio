"use client";

// Global store para sa Cart at Wishlist.
// Naka-save sa localStorage kaya hindi nawawala kahit i-refresh ang page.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type CartItem = {
  slug: string;
  color: string; // variant key (kulay / size) — ginagamit din bilang ID
  qty: number;
  // Presyo kada isa SA ORAS NG PAG-ADD — kasama na ang napiling size at
  // mga add-on. Kung wala (lumang cart), babalik sa product.price.
  unitPrice?: number;
  // Structured breakdown para sa malinis na display sa cart/checkout
  baseLabel?: string; // hal. "Lafayette Choco / Single"
  basePrice?: number; // presyo ng bed frame lang
  addOns?: { label: string; price: number; note?: string }[];
  // Litrato ng napiling kulay (IMS 0231) - kung wala, product.images[0].
  image?: string | null;
};

// QUOTE REQUEST — hiwalay sa cart. Ang bumili agad at ang magpapresyo muna ay
// magkaibang layunin; ang gumagawa ng dalawa nang sabay ay hindi dapat makita
// silang naghahalo. Isang made-to-order build kada slot, walang takda ang dami.
export type QuoteBuild = {
  // SARILING ID, HINDI slug+color. Ang cart ay naka-key sa slug+color kaya ang
  // dalawang entry ng iisang produkto ay nagpapatong; dito, ordinaryo ang
  // parehong kama sa magkaibang tela (master at guest), kaya kailangan nila ng
  // sariling pagkakakilanlan.
  id: string;
  slug: string;
  sku?: string | null;
  name: string;
  image?: string | null;
  category?: string | null;
  // Buod para sa panel — hindi na kailangang buksan ang buong build para makita
  // kung alin ito.
  summary?: string;
  build: {
    size?: string;
    fabric?: string;
    fabrics?: { name: string; part?: string }[];
    lines?: { label: string; price?: number }[];
    total?: number;
    priced?: boolean;
  };
  // ANG BUONG KALAGAYAN NG CONFIGURATOR, para tunay na maibalik ng "Edit".
  // Hindi sapat ang build.lines: ang mga iyon ay tekstong pang-basa
  // ("2 built-in drawers — Left"), hindi ang mga piniling halaga. Kung ang
  // Edit ay muling bubuo mula sa teksto, ang bawat pagbabago ng pananalita ay
  // tahimik na sisira sa pagbabalik — at ang nawawalang add-on ay hindi
  // mapapansin hangga't hindi na naipadala ang mali.
  state?: {
    size?: string;
    fabrics?: { name: string; part: string }[];
    choiceSel?: Record<string, string>;
    checkPick?: Record<string, boolean>;
    measVal?: Record<string, number>;
    fieldVal?: Record<string, string>;
    dwThick?: number;
    dwH?: string;
    dwPad?: string;
    dwW?: string;
    dwNails?: string;
    dwAccent?: boolean;
  };
};

type StoreState = {
  cart: CartItem[];
  wishlist: string[]; // product slugs
  quote: QuoteBuild[];
  addToQuote: (b: Omit<QuoteBuild, "id"> & { id?: string }) => string;
  removeFromQuote: (id: string) => void;
  clearQuote: () => void;
  quoteCount: number;
  quoteTotal: number;
  addToCart: (
    slug: string,
    color: string,
    qty?: number,
    unitPrice?: number,
    extra?: Pick<CartItem, "baseLabel" | "basePrice" | "addOns" | "image">
  ) => void;
  removeFromCart: (slug: string, color: string) => void;
  setQty: (slug: string, color: string, qty: number) => void;
  clearCart: () => void;
  toggleWishlist: (slug: string) => void;
  cartCount: number;
};

const StoreContext = createContext<StoreState | null>(null);

const CART_KEY = "pan_cart";
const WISHLIST_KEY = "pan_wishlist";
const QUOTE_KEY = "pan_quote";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [quote, setQuote] = useState<QuoteBuild[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // I-load mula localStorage sa unang render (client lang)
  useEffect(() => {
    try {
      const c = localStorage.getItem(CART_KEY);
      const w = localStorage.getItem(WISHLIST_KEY);
      const q = localStorage.getItem(QUOTE_KEY);
      if (c) setCart(JSON.parse(c));
      if (w) setWishlist(JSON.parse(w));
      if (q) setQuote(JSON.parse(q));
    } catch {
      // sira ang stored data — balewalain, magsimula sa wala
    }
    setHydrated(true);
  }, []);

  // I-save tuwing may pagbabago
  useEffect(() => {
    if (hydrated) localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart, hydrated]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlist));
  }, [wishlist, hydrated]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(QUOTE_KEY, JSON.stringify(quote));
  }, [quote, hydrated]);

  function addToCart(
    slug: string,
    color: string,
    qty = 1,
    unitPrice?: number,
    extra?: Pick<CartItem, "baseLabel" | "basePrice" | "addOns" | "image">
  ) {
    setCart((prev) => {
      const existing = prev.find((i) => i.slug === slug && i.color === color);
      if (existing) {
        return prev.map((i) =>
          i.slug === slug && i.color === color
            ? { ...i, qty: i.qty + qty, unitPrice: unitPrice ?? i.unitPrice, ...extra }
            : i
        );
      }
      return [...prev, { slug, color, qty, unitPrice, ...extra }];
    });
  }

  function removeFromCart(slug: string, color: string) {
    setCart((prev) => prev.filter((i) => !(i.slug === slug && i.color === color)));
  }

  function setQty(slug: string, color: string, qty: number) {
    if (qty < 1) return removeFromCart(slug, color);
    setCart((prev) =>
      prev.map((i) => (i.slug === slug && i.color === color ? { ...i, qty } : i))
    );
  }

  function clearCart() {
    setCart([]);
  }

  // Nagbabalik ng id ng slot — ginagamit ng "Edit" para malaman kung alin ang
  // binabago (pinapalitan, hindi dinadagdag).
  function addToQuote(b: Omit<QuoteBuild, "id"> & { id?: string }) {
    // Walang crypto.randomUUID sa lumang WebView (Huawei/Chrome<99) — ang app
    // ay tumatakbo doon, kaya hindi ito maaasahan.
    const id = b.id ?? `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    setQuote((prev) => {
      const i = prev.findIndex((x) => x.id === id);
      const next = { ...b, id } as QuoteBuild;
      if (i === -1) return [...prev, next];
      const copy = [...prev];
      copy[i] = next;
      return copy;
    });
    return id;
  }

  function removeFromQuote(id: string) {
    setQuote((prev) => prev.filter((b) => b.id !== id));
  }

  function clearQuote() {
    setQuote([]);
  }

  function toggleWishlist(slug: string) {
    setWishlist((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }

  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);
  const quoteCount = quote.length;
  const quoteTotal = quote.reduce((sum, b) => sum + (Number(b.build?.total) || 0), 0);

  return (
    <StoreContext.Provider
      value={{
        cart,
        wishlist,
        quote,
        addToCart,
        removeFromCart,
        setQty,
        clearCart,
        addToQuote,
        removeFromQuote,
        clearQuote,
        toggleWishlist,
        cartCount,
        quoteCount,
        quoteTotal,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): StoreState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}
