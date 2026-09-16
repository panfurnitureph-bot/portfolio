import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageIcon, Plus, X, ChevronLeft, ChevronRight } from "lucide-react";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { toast } from "sonner";

const SELLERCLOUD_BASE = "https://erp.example.invalid/product-image";
const TABLE_NAME = "shopify_store";

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-lg border border-border bg-card p-4 ${className}`}>{children}</div>
);

export type ShopifyRow = {
  id: number | string;
  sku: string;
  description: string | null;
  oh_inv: number | null;
  on_order_units: number | null;
  otw_units: number | null;
  po_in_progress: number | null;
};

function parseNameColor(desc: string | null) {
  if (!desc) return { name: "", color: "" };
  const m = desc.match(/^(.*?)\s+in\s+(.*)$/i);
  if (m) return { name: m[1].trim(), color: m[2].trim() };
  const p = desc.split("|").map((s) => s.trim());
  if (p.length === 2) return { name: p[0], color: p[1] };
  return { name: desc, color: "" };
}

export function buildName(name: string, color: string) {
  if (name && color) return `${name} in ${color}`;
  return name || color || "";
}

export function ShopifyVariantThumb({ sku, size = 32, src }: { sku: string; size?: number; src?: string }) {
  const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); }, [src, sku]);
  const url = src && src.trim() ? src : `${SELLERCLOUD_BASE}?ProductID=${encodeURIComponent(sku)}&MaxWidth=200`;
  if ((!sku && !src) || err) {
    return (
      <div
        className="rounded border border-border bg-muted flex items-center justify-center shrink-0"
        style={{ width: size, height: size }}
      >
        <ImageIcon className="h-3 w-3 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={sku}
      onError={() => setErr(true)}
      loading="lazy"
      className="rounded border border-border object-cover bg-muted shrink-0"
      style={{ width: size, height: size }}
    />
  );
}

function GalleryImg({ src, alt }: { src: string; alt: string }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted">
        <ImageIcon className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setErr(true)}
      className="w-full h-full object-cover"
    />
  );
}

export function ShopifyVariantDialog({
  open,
  onOpenChange,
  row,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: ShopifyRow | null;
  onSaved?: () => void;
}) {
  const initial = useMemo(() => parseNameColor(row?.description ?? ""), [row]);
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState<string>("");
  const [barcode, setBarcode] = useState<string>("");
  const [sellOOS, setSellOOS] = useState(true);
  const [ohInv, setOhInv] = useState<string>("");
  const [committed, setCommitted] = useState<string>("0");
  const [unavailable, setUnavailable] = useState<string>("0");
  const [onOrder, setOnOrder] = useState<string>("");
  const [otw, setOtw] = useState<string>("");
  const [poInProgress, setPoInProgress] = useState<string>("");
  const [weight, setWeight] = useState<string>("");
  const [weightUnit, setWeightUnit] = useState("lb");
  const [packageType, setPackageType] = useState("Store default");
  const [inventoryTracked, setInventoryTracked] = useState(true);
  const [physicalProduct, setPhysicalProduct] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [validImages, setValidImages] = useState<string[]>([]);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const lastThumbIndex = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!sku) {
      setGalleryImages([]);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("shopify_variant_mapping")
        .select(
          "image_url_1,image_url_2,image_url_3,image_url_4,image_url_5,image_url_6,image_url_7,image_url_8,image_url_9,image_url_10,image_url_11,image_url_12,image_url_13,image_url_14,image_url_15,image_url_16,image_url_17,image_url_18,image_url_19,image_url_20",
        )
        .eq("sku", sku)
        .maybeSingle();
      if (cancelled) return;
      const urls: string[] = [];
      if (data) {
        for (let i = 1; i <= 20; i++) {
          const v = (data as any)[`image_url_${i}`];
          if (v != null && typeof v === "string") {
            const t = v.trim();
            if (t && /^https?:\/\//i.test(t)) urls.push(t);
          }
        }
      }
      setGalleryImages(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [sku]);

  // Probe each URL — only keep those that load successfully
  useEffect(() => {
    let cancelled = false;
    setValidImages([]);
    if (galleryImages.length === 0) return;
    const results: { url: string; ok: boolean; idx: number }[] = [];
    let done = 0;
    galleryImages.forEach((url, idx) => {
      const img = new Image();
      img.onload = () => {
        results.push({ url, ok: true, idx });
        if (++done === galleryImages.length && !cancelled) {
          setValidImages(
            results
              .filter((r) => r.ok)
              .sort((a, b) => a.idx - b.idx)
              .map((r) => r.url),
          );
        }
      };
      img.onerror = () => {
        results.push({ url, ok: false, idx });
        if (++done === galleryImages.length && !cancelled) {
          setValidImages(
            results
              .filter((r) => r.ok)
              .sort((a, b) => a.idx - b.idx)
              .map((r) => r.url),
          );
        }
      };
      img.src = url;
    });
    return () => {
      cancelled = true;
    };
  }, [galleryImages]);


  const openLightbox = useCallback((i: number) => {
    lastThumbIndex.current = i;
    setLightboxIndex(i);
    requestAnimationFrame(() => setLightboxVisible(true));
  }, []);
  const closeLightbox = useCallback(() => {
    setLightboxVisible(false);
    setTimeout(() => {
      setLightboxIndex(null);
      const idx = lastThumbIndex.current;
      if (idx != null) thumbRefs.current[idx]?.focus();
    }, 200);
  }, []);
  const nextImage = useCallback(
    () =>
      setLightboxIndex((i) =>
        i === null || validImages.length === 0 ? i : (i + 1) % validImages.length,
      ),
    [validImages.length],
  );
  const prevImage = useCallback(
    () =>
      setLightboxIndex((i) =>
        i === null || validImages.length === 0
          ? i
          : (i - 1 + validImages.length) % validImages.length,
      ),
    [validImages.length],
  );

  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeLightbox();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nextImage();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prevImage();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [lightboxIndex, closeLightbox, nextImage, prevImage]);

  useEffect(() => {
    if (!row) return;
    setName(initial.name);
    setColor(initial.color);
    setSku(row.sku ?? "");
    setOhInv(row.oh_inv == null ? "" : String(row.oh_inv));
    setOnOrder(row.on_order_units == null ? "" : String(row.on_order_units));
    setOtw(row.otw_units == null ? "" : String(row.otw_units));
    setPoInProgress(row.po_in_progress == null ? "" : String(row.po_in_progress));
    setPrice("");
    setBarcode("");
    setSellOOS(true);
    setCommitted("0");
    setUnavailable("0");
    setWeight("");
    setWeightUnit("lb");
    setPackageType("Store default");

    // Fetch extra fields from shopify_store
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from(TABLE_NAME)
        .select("price,barcode,package,product_weight,weight_unit")
        .eq("id", row.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const d = data as any;
      setPrice(d.price == null ? "" : String(d.price));
      setBarcode(d.barcode ?? "");
      setPackageType(d.package ?? "Store default");
      setWeight(d.product_weight == null ? "" : String(d.product_weight));
      setWeightUnit(d.weight_unit ?? "lb");
    })();
    return () => {
      cancelled = true;
    };
  }, [row, initial]);

  const available = useMemo(() => {
    const oh = Number(ohInv) || 0;
    const c = Number(committed) || 0;
    const u = Number(unavailable) || 0;
    return Math.max(0, oh - c - u);
  }, [ohInv, committed, unavailable]);

  if (!row) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        sku: sku.trim(),
        description: buildName(name.trim(), color.trim()) || row.description,
        oh_inv: ohInv === "" ? null : Number(ohInv),
        on_order_units: onOrder === "" ? null : Number(onOrder),
        otw_units: otw === "" ? null : Number(otw),
        po_in_progress: poInProgress === "" ? null : Number(poInProgress),
        price: price === "" ? null : Number(price),
        barcode: barcode.trim() || null,
        package: packageType || null,
        product_weight: weight === "" ? null : Number(weight),
        weight_unit: weightUnit || "lb",
      };
      const { error } = await supabase.from(TABLE_NAME).update(payload).eq("id", row.id);
      if (error) throw error;
      toast.success("Variant updated");
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message ?? "unknown"));
    } finally {
      setSaving(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] max-h-[92vh] overflow-hidden p-0 gap-0">
        <div className="flex flex-col h-[92vh]">
          {/* Body */}
          <div className="flex-1 overflow-auto p-5 bg-muted/30">
            <div className="grid grid-cols-12 gap-4">
              {/* LEFT SIDEBAR */}
              <aside className="col-span-12 lg:col-span-4 space-y-3">
                <Card>
                  <div className="flex items-start gap-3">
                    <ShopifyVariantThumb sku={sku} size={56} src={validImages[0]} />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold leading-tight break-words">
                        {buildName(name, color) || "Untitled"}
                      </h2>
                      <Badge variant="secondary" className="mt-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                        Active
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">1 variant</p>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="text-xs font-medium text-muted-foreground mb-2">Color</div>
                  <div className="rounded-md bg-muted/50 px-3 py-2 flex items-center gap-2">
                    <ShopifyVariantThumb sku={sku} size={20} src={validImages[0]} />
                    <span className="text-sm">{color || "—"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">1 variant</p>
                </Card>

                <Card>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-medium text-muted-foreground">Images</div>
                    <span className="text-[11px] text-muted-foreground">{validImages.length}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 max-h-[360px] overflow-auto pr-1">
                    {validImages.map((src, i) => (
                      <button
                        key={i}
                        ref={(el) => (thumbRefs.current[i] = el)}
                        type="button"
                        onClick={() => openLightbox(i)}
                        className="aspect-square rounded-md border border-border bg-muted overflow-hidden hover:ring-2 hover:ring-primary transition focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <GalleryImg src={src} alt={`Image ${i + 1}`} />
                      </button>
                    ))}
                  </div>
                </Card>
              </aside>

              {/* RIGHT */}
              <section className="col-span-12 lg:col-span-8 space-y-3">
                {/* Variant info */}
                <Card>
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      className="h-20 w-20 rounded-md border-2 border-dashed border-border flex items-center justify-center bg-background hover:bg-muted shrink-0"
                    >
                      <Plus className="h-5 w-5 text-muted-foreground" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold mb-3">{color || "Variant"}</h3>
                      <div className="grid gap-1.5">
                        <Label className="text-xs">Color</Label>
                        <Input value={color} onChange={(e) => setColor(e.target.value)} className="h-9" />
                      </div>
                      <div className="grid gap-1.5 mt-3">
                        <Label className="text-xs">Product name</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Price */}
                <Card>
                  <h3 className="text-sm font-semibold mb-3">Price</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Price</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                        <Input
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          placeholder="0.00"
                          className="h-9 pl-7"
                          type="number"
                          step="0.01"
                        />
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Inventory */}
                <Card>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">Inventory</h3>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Inventory tracked</Label>
                      <Switch checked={inventoryTracked} onCheckedChange={setInventoryTracked} />
                    </div>
                  </div>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Locations</th>
                          <th className="text-right px-3 py-2 font-medium">Unavailable</th>
                          <th className="text-right px-3 py-2 font-medium">Committed</th>
                          <th className="text-right px-3 py-2 font-medium">Available</th>
                          <th className="text-right px-3 py-2 font-medium">On Hand</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-border">
                          <td className="px-3 py-2 text-primary font-medium">Cedar Point Parts Depot</td>
                          <td className="px-3 py-1">
                            <Input
                              type="number"
                              value={unavailable}
                              onChange={(e) => setUnavailable(e.target.value)}
                              className="h-8 text-right tabular-nums"
                            />
                          </td>
                          <td className="px-3 py-1">
                            <Input
                              type="number"
                              value={committed}
                              onChange={(e) => setCommitted(e.target.value)}
                              className="h-8 text-right tabular-nums"
                            />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {available.toLocaleString()}
                          </td>
                          <td className="px-3 py-1">
                            <Input
                              type="number"
                              value={ohInv}
                              onChange={(e) => setOhInv(e.target.value)}
                              className="h-8 text-right tabular-nums"
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* extras */}
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">On Order</Label>
                      <Input type="number" value={onOrder} onChange={(e) => setOnOrder(e.target.value)} className="h-9" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">On the Water</Label>
                      <Input type="number" value={otw} onChange={(e) => setOtw(e.target.value)} className="h-9" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">PO in Progress</Label>
                      <Input
                        type="number"
                        value={poInProgress}
                        onChange={(e) => setPoInProgress(e.target.value)}
                        className="h-9"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="rounded-md bg-muted/40 px-3 py-2 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">SKU</span>
                      <Input value={sku} onChange={(e) => setSku(e.target.value)} className="h-7 text-xs flex-1" />
                    </div>
                    <div className="rounded-md bg-muted/40 px-3 py-2 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Barcode</span>
                      <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} className="h-7 text-xs flex-1" />
                    </div>
                    <div className="rounded-md bg-muted/40 px-3 py-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Sell when out of stock</span>
                      <Switch checked={sellOOS} onCheckedChange={setSellOOS} />
                    </div>
                  </div>
                </Card>

                {/* Shipping */}
                <Card>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">Shipping</h3>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Physical product</Label>
                      <Switch checked={physicalProduct} onCheckedChange={setPhysicalProduct} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Package</Label>
                      <Input
                        value={packageType}
                        onChange={(e) => setPackageType(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Product weight</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={weight}
                          onChange={(e) => setWeight(e.target.value)}
                          className="h-9 flex-1"
                        />
                        <Select value={weightUnit} onValueChange={setWeightUnit}>
                          <SelectTrigger className="h-9 w-20"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lb">lb</SelectItem>
                            <SelectItem value="kg">kg</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </Card>
              </section>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-background">
            <p className="mr-auto text-xs text-muted-foreground">
              All fields are saved to the database.
            </p>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {lightboxIndex !== null &&
          createPortal(
            <div
              className={`fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center transition-opacity duration-200 ${lightboxVisible ? "opacity-100" : "opacity-0"}`}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={closeLightbox}
              role="dialog"
              aria-modal="true"
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
                className="fixed top-4 right-4 h-11 w-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center z-10"
                aria-label="Close preview"
                autoFocus
              >
                <X className="h-5 w-5" />
              </button>
              {validImages.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); prevImage(); }}
                    className="fixed left-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center z-10"
                    aria-label="Previous image"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); nextImage(); }}
                    className="fixed right-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center z-10"
                    aria-label="Next image"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                </>
              )}
              <img
                key={lightboxIndex}
                src={validImages[lightboxIndex]}
                alt={`Image ${lightboxIndex + 1}`}
                onClick={(e) => e.stopPropagation()}
                className="max-h-[85vh] max-w-[85vw] w-auto h-auto object-contain rounded-md shadow-2xl transition-opacity duration-150"
              />
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 text-white/90 text-sm bg-black/60 px-4 py-1.5 rounded-full">
                {lightboxIndex + 1} / {validImages.length}
              </div>
            </div>,
            document.body,
          )}
      </DialogContent>
    </Dialog>
  );
}
