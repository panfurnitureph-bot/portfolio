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
};

type StoreState = {
  cart: CartItem[];
  wishlist: string[]; // product slugs
  addToCart: (
    slug: string,
    color: string,
    qty?: number,
    unitPrice?: number,
    extra?: Pick<CartItem, "baseLabel" | "basePrice" | "addOns">
  ) => void;
  removeFromCart: (slug: string, color: string) => void;
  setQty: (slug: string, color: string, qty: number) => void;
  clearCart: () => void;
  toggleWishlist: (slug: string) => void;
  cartCount: number;
};

const StoreContext = createContext<StoreState | null>(null);

const CART_KEY = "pb_cart";
const WISHLIST_KEY = "pb_wishlist";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // I-load mula localStorage sa unang render (client lang)
  useEffect(() => {
    try {
      const c = localStorage.getItem(CART_KEY);
      const w = localStorage.getItem(WISHLIST_KEY);
      if (c) setCart(JSON.parse(c));
      if (w) setWishlist(JSON.parse(w));
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

  function addToCart(
    slug: string,
    color: string,
    qty = 1,
    unitPrice?: number,
    extra?: Pick<CartItem, "baseLabel" | "basePrice" | "addOns">
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

  function toggleWishlist(slug: string) {
    setWishlist((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }

  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);

  return (
    <StoreContext.Provider
      value={{
        cart,
        wishlist,
        addToCart,
        removeFromCart,
        setQty,
        clearCart,
        toggleWishlist,
        cartCount,
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
