import React, { useState, useRef, useCallback, useEffect } from "react";
import ReactDOM from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
// PORTFOLIO DEMO: product art is the generated motor-parts SVG set (src/procure/part-images.ts), not a production storage bucket.
import { PART_PHOTOS as ALL_PHOTOS } from "../../../db/part-images";
const demoPhoto = (productId: string) => { let h = 0; for (const ch of productId) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return ALL_PHOTOS[h % ALL_PHOTOS.length]; };

const SUPABASE_URL = "https://demo-storage.example.invalid";
const THUMB_BUCKET = "product-images-thumb";
const PREVIEW_BUCKET = "product-images-preview";
const VALID_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Builds a cache-busting query suffix from either a DB-persisted timestamp
 * (survives refresh) or an in-memory bust string (set immediately post-upload
 * before the parent refetches). The DB value wins so we always read the
 * latest server-confirmed state.
 */
function bustParam(imageUpdatedAt?: string | null, sessionBust = ""): string {
  if (imageUpdatedAt) {
    const ms = new Date(imageUpdatedAt).getTime();
    if (Number.isFinite(ms)) return `?t=${ms}`;
  }
  return sessionBust;
}

const getThumbUrl = (productId: string, bust = "") => { void bust; void SUPABASE_URL; void THUMB_BUCKET; return demoPhoto(productId); };

const getPreviewUrl = (productId: string, bust = "") => { void bust; void PREVIEW_BUCKET; return demoPhoto(productId); };

/**
 * Canvas resize. Fills target canvas with dark bg (#2D3748) and centers the
 * aspect-preserved image. Returns PNG blob.
 */
function resizeImage(file: File, width: number, height: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);

      // Aspect-fit scale
      let w = img.width;
      let h = img.height;
      const ratio = Math.min(width / w, height / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);

      ctx.fillStyle = "#2D3748";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
      canvas.toBlob((blob) => resolve(blob), "image/png");
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

interface ProductImageProps {
  productId: string;
  productName?: string;
  thumbSize?: number;
  previewSize?: number;
  /** Disable upload modal (display-only mode). */
  readOnly?: boolean;

  /**
   * Timestamp (ISO string) of last image upload, from inventory.image_updated_at.
   * Drives the ?t= query param so post-refresh URLs invalidate the browser CDN
   * cache. Pass null/undefined if unknown — the component falls back to a
   * session-only bust set after a successful upload from this component.
   */
  imageUpdatedAt?: string | null;
}

function ProductImageImpl({
  productId,
  productName = "",
  thumbSize = 40,
  previewSize = 200,
  readOnly = false,
  imageUpdatedAt = null,
}: ProductImageProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [isPlaceholder, setIsPlaceholder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [cacheBust, setCacheBust] = useState("");
  const [imageKey, setImageKey] = useState(0);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    };
  }, [uploadPreview]);

  const handleThumbError = useCallback(() => {
    setIsPlaceholder(true);
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (showUpload || !productId) return;

    const img = new Image();
    img.src = getPreviewUrl(productId, bustParam(imageUpdatedAt, cacheBust));
    img.onload = () => setPreviewLoaded(true);

    if (thumbRef.current) {
      const rect = thumbRef.current.getBoundingClientRect();
      const spaceRight = window.innerWidth - rect.right;
      setPosition({
        top: rect.top + window.scrollY - 20,
        left:
          spaceRight > previewSize + 20
            ? rect.right + window.scrollX + 8
            : rect.left + window.scrollX - previewSize - 8,
      });
    }

    timeoutRef.current = setTimeout(() => setShowPreview(true), 200);
  }, [productId, previewSize, showUpload, cacheBust, imageUpdatedAt]);

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowPreview(false);
    setPreviewLoaded(false);
  }, []);

  const handleClick = useCallback(() => {
    if (readOnly || !productId) return;
    setShowPreview(false);
    setShowUpload(true);
    setUploadSuccess(false);
    setUploadError(null);
  }, [readOnly, productId]);

  const validateAndStage = useCallback(
    (file: File) => {
      if (!VALID_TYPES.includes(file.type)) {
        setUploadError("Please select a JPG, PNG, or WEBP image.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setUploadError("File too large. Max 5MB.");
        return;
      }
      setUploadError(null);
      setSelectedFile(file);
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
      setUploadPreview(URL.createObjectURL(file));
    },
    [uploadPreview],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) validateAndStage(file);
    },
    [validateAndStage],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) validateAndStage(file);
    },
    [validateAndStage],
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile || !productId) return;
    setUploading(true);
    setUploadError(null);

    try {
      const [thumbBlob, previewBlob] = await Promise.all([
        resizeImage(selectedFile, 40, 40),
        resizeImage(selectedFile, 200, 200),
      ]);

      if (!thumbBlob || !previewBlob) {
        throw new Error("Image resize failed");
      }

      const fileName = `${productId}.png`;

      // Delete-then-upload (not upsert) to force CDN cache purge. upsert
      // replaces the object but Supabase CDN may keep serving the stale
      // edge-cached copy until TTL expires. .remove() invalidates the CDN
      // entry; the 500ms delay gives edge nodes time to drop the cache
      // before the fresh PUT lands.
      await Promise.all([
        (supabase as any).storage.from(THUMB_BUCKET).remove([fileName]),
        (supabase as any).storage.from(PREVIEW_BUCKET).remove([fileName]),
      ]);
      await new Promise((r) => setTimeout(r, 500));

      const { error: thumbError } = await (supabase as any).storage
        .from(THUMB_BUCKET)
        .upload(fileName, thumbBlob, { contentType: "image/png", cacheControl: "0" });
      if (thumbError) throw thumbError;

      const { error: previewError } = await (supabase as any).storage
        .from(PREVIEW_BUCKET)
        .upload(fileName, previewBlob, { contentType: "image/png", cacheControl: "0" });
      if (previewError) throw previewError;

      // Persist upload timestamp so the cache-bust query param survives page
      // refreshes. The .update() targets the inventory row by productid; if
      // the row doesn't exist (e.g., forecast-only SKU not in inventory yet)
      // we silently ignore — the in-memory cacheBust still covers this session.
      const nowIso = new Date().toISOString();
      const { error: tsError } = await (supabase as any)
        .from("inventory")
        .update({ image_updated_at: nowIso })
        .eq("productid", productId);

      const bust = `?t=${Date.now()}`;

      // Preload new thumb into browser cache BEFORE we swap the DOM <img>.
      // Combined with the React `key` bump below, this forces a clean remount
      // with the fresh bytes already warm — no flicker, no race between
      // browser memory cache and the new URL.
      await new Promise<void>((resolve) => {
        const warm = new Image();
        warm.onload = () => resolve();
        warm.onerror = () => resolve(); // don't block UX on preload failure
        warm.src = getThumbUrl(productId, bust);
      });

      setCacheBust(bust);
      setImageKey((k) => k + 1);
      setIsPlaceholder(false);
      setUploadSuccess(true);

      // Nuclear invalidate so every consumer (ProductList, SaleTracker,
      // MonthlyForecast, etc.) refetches image_updated_at and renders the
      // new ?t= bust. Scope to specific keys later if perf matters.
      queryClient.invalidateQueries();

      setTimeout(() => {
        setShowUpload(false);
        setSelectedFile(null);
        if (uploadPreview) URL.revokeObjectURL(uploadPreview);
        setUploadPreview(null);
        setUploadSuccess(false);
      }, 1500);
    } catch (error: any) {
      setUploadError(error?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [selectedFile, productId, uploadPreview, queryClient]);

  const handleCancel = useCallback(() => {
    if (uploading) return;
    setShowUpload(false);
    setSelectedFile(null);
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadPreview(null);
    setUploadError(null);
  }, [uploading, uploadPreview]);

  if (!productId) {
    return (
      <div
        style={{
          width: thumbSize,
          height: thumbSize,
          borderRadius: 4,
          backgroundColor: "var(--bg-tertiary)",
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
    );
  }

  return (
    <>
      <div style={{ position: "relative", display: "inline-block", flexShrink: 0 }}>
        <img
          key={`thumb-${productId}-${imageKey}`}
          ref={thumbRef}
          src={getThumbUrl(productId, bustParam(imageUpdatedAt, cacheBust))}
          alt={productName || productId}
          loading="lazy"
          onError={handleThumbError}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          style={{
            width: thumbSize,
            height: thumbSize,
            objectFit: "cover",
            borderRadius: 4,
            backgroundColor: "var(--bg-tertiary)",
            cursor: readOnly ? "default" : "pointer",
            display: "block",
          }}
        />

        {!readOnly && isPlaceholder && (
          <div
            onClick={handleClick}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(0,0,0,0.4)",
              borderRadius: 4,
              cursor: "pointer",
              opacity: 0,
              transition: "opacity 150ms",
            }}
            title="Upload image"
          >
            <span style={{ color: "#fff", fontSize: 16 }}>⬆</span>
          </div>
        )}
      </div>

      {showPreview && !showUpload &&
        ReactDOM.createPortal(
          <div
            style={{
              position: "fixed",
              top: Math.min(position.top, window.innerHeight - previewSize - 60),
              left: Math.max(8, position.left),
              zIndex: 9999,
              background: "#1A202C",
              borderRadius: 8,
              padding: 8,
              boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
              opacity: previewLoaded ? 1 : 0,
              transition: "opacity 150ms ease",
              pointerEvents: "none",
            }}
          >
            <img
              src={getPreviewUrl(productId, bustParam(imageUpdatedAt, cacheBust))}
              alt={productName || productId}
              style={{
                width: previewSize,
                height: previewSize,
                objectFit: "cover",
                borderRadius: 4,
                display: "block",
              }}
            />
            {productName && (
              <div
                style={{
                  color: "#E2E8F0",
                  fontSize: 12,
                  marginTop: 6,
                  textAlign: "center",
                  maxWidth: previewSize,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {productName}
              </div>
            )}
          </div>,
          document.body,
        )}

      {showUpload &&
        ReactDOM.createPortal(
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) handleCancel();
            }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 10000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(0,0,0,0.6)",
            }}
          >
            <div
              style={{
                background: "#1A202C",
                borderRadius: 12,
                padding: 24,
                width: 360,
                maxWidth: "90vw",
                color: "#E2E8F0",
              }}
            >
              <h3 style={{ margin: "0 0 4px 0", fontSize: 16, color: "#fff" }}>Upload Image</h3>
              {productName && (
                <p style={{ margin: "0 0 4px 0", fontSize: 14, color: "#A0AEC0" }}>{productName}</p>
              )}
              <p style={{ margin: "0 0 16px 0", fontSize: 12, color: "#718096" }}>
                {productId} — file will auto-save as {productId}.png
              </p>

              {uploadSuccess ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "24px 0",
                    color: "#48BB78",
                    fontSize: 16,
                  }}
                >
                  ✅ Image uploaded successfully!
                </div>
              ) : (
                <>
                  {!uploadPreview ? (
                    <div
                      onDrop={handleDrop}
                      onDragOver={(e) => e.preventDefault()}
                      onClick={() => fileInputRef.current?.click()}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#63B3ED")}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#4A5568")}
                      style={{
                        border: "2px dashed #4A5568",
                        borderRadius: 8,
                        padding: "32px 16px",
                        textAlign: "center",
                        cursor: "pointer",
                        transition: "border-color 150ms",
                      }}
                    >
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
                      <div style={{ fontSize: 14, color: "#A0AEC0" }}>Drag &amp; drop image here</div>
                      <div style={{ fontSize: 12, color: "#718096", marginTop: 4 }}>
                        or click to browse — JPG, PNG, WEBP (max 5MB)
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: "center" }}>
                      <img
                        src={uploadPreview}
                        alt="Preview"
                        style={{
                          maxWidth: 200,
                          maxHeight: 200,
                          borderRadius: 8,
                          objectFit: "contain",
                        }}
                      />
                      <div style={{ fontSize: 12, color: "#718096", marginTop: 8 }}>
                        Will be saved as: {productId}.png (auto-resized to 40×40 + 200×200)
                      </div>
                    </div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    onChange={handleFileSelect}
                    style={{ display: "none" }}
                  />

                  {uploadError && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: "8px 12px",
                        background: "rgba(245, 101, 101, 0.15)",
                        border: "1px solid #F56565",
                        borderRadius: 6,
                        color: "#FEB2B2",
                        fontSize: 12,
                      }}
                    >
                      {uploadError}
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 16,
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={uploading}
                      style={{
                        padding: "8px 16px",
                        borderRadius: 6,
                        border: "1px solid #4A5568",
                        background: "transparent",
                        color: "#A0AEC0",
                        cursor: uploading ? "not-allowed" : "pointer",
                        fontSize: 14,
                      }}
                    >
                      Cancel
                    </button>
                    {uploadPreview && (
                      <button
                        type="button"
                        onClick={handleUpload}
                        disabled={uploading}
                        style={{
                          padding: "8px 16px",
                          borderRadius: 6,
                          border: "none",
                          background: uploading ? "#4A5568" : "#3182CE",
                          color: "#fff",
                          cursor: uploading ? "not-allowed" : "pointer",
                          fontSize: 14,
                        }}
                      >
                        {uploading ? "⏳ Uploading..." : "⬆ Upload"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export const ProductImage = React.memo(ProductImageImpl);
export default ProductImage;
