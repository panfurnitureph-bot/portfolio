// Location clustering para sa Delivery Queue — pinagpapangkat ang mga QC-passed
// na order ayon sa LAPIT NG DELIVERY LOCATIONS SA ISA'T ISA (pairwise haversine
// sa address_lat/lng), HINDI base sa warehouse. Walang AI/API — ₱0.

export type ClusterPoint = {
  id: number;
  lat: number | null;
  lng: number | null;
  address: string | null;
};

export type Cluster<T extends ClusterPoint> = {
  label: string;    // "San Pedro / Landayan area" — hango sa mga address
  members: T[];
};

const R = 6371; // km
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat), dLng = r(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Kunin ang "city, province" na bahagi ng address bilang label ng lugar.
function areaOf(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean)
    // alisin ang bansa/ZIP na dulo
    .filter((p) => !/^philippines$/i.test(p) && !/^\d{4,}$/.test(p));
  if (parts.length >= 2) return parts.slice(-2).join(", ");
  return parts[parts.length - 1] ?? null;
}

// Union-find na clustering: magkasama ang dalawang order kapag ang delivery
// locations nila ay magkalapit (< thresholdKm). Ang mga WALANG coordinates ay
// pinagpapangkat ayon sa area text ng address (best effort).
export function clusterByProximity<T extends ClusterPoint>(points: T[], thresholdKm = 5): Cluster<T>[] {
  const withLoc = points.filter((p) => p.lat != null && p.lng != null);
  const noLoc = points.filter((p) => p.lat == null || p.lng == null);

  // union-find
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== c) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const p of withLoc) parent.set(p.id, p.id);
  for (let i = 0; i < withLoc.length; i++) {
    for (let j = i + 1; j < withLoc.length; j++) {
      const a = withLoc[i], b = withLoc[j];
      if (haversineKm(a.lat!, a.lng!, b.lat!, b.lng!) < thresholdKm) {
        parent.set(find(a.id), find(b.id));
      }
    }
  }
  const byRoot = new Map<number, T[]>();
  for (const p of withLoc) {
    const r = find(p.id);
    byRoot.set(r, [...(byRoot.get(r) ?? []), p]);
  }

  // Mga walang pin: pangkatin ayon sa area text.
  const byArea = new Map<string, T[]>();
  for (const p of noLoc) {
    const a = areaOf(p.address) ?? "No location";
    byArea.set(a, [...(byArea.get(a) ?? []), p]);
  }

  const clusters: Cluster<T>[] = [];
  for (const members of byRoot.values()) clusters.push({ label: labelFor(members), members });
  for (const [area, members] of byArea) clusters.push({ label: `${area} area`, members });

  // HULING hakbang: pagsamahin ang mga cluster na PAREHO ang area label — kahit
  // magkalayo ang geocoded pins (o walang pin ang iba), kapag iisang lugar ang
  // sinasabi ng address, iisang grupo dapat sila sa Ops.
  const byLabel = new Map<string, Cluster<T>>();
  for (const c of clusters) {
    const key = c.label.trim().toLowerCase();
    const hit = byLabel.get(key);
    if (hit) hit.members.push(...c.members);
    else byLabel.set(key, { label: c.label, members: [...c.members] });
  }
  const merged = [...byLabel.values()];
  // Pinakamalaking grupo muna — iyon ang pinaka-kapaki-pakinabang na aksyunan.
  merged.sort((a, b) => b.members.length - a.members.length);
  return merged;
}

// Label = pinakakaraniwang area sa grupo; kapag dalawa ang pantay, pagdugtungin.
function labelFor(members: ClusterPoint[]): string {
  const counts = new Map<string, number>();
  for (const m of members) {
    const a = areaOf(m.address);
    if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => a.split(",")[0].trim());
  const uniq = [...new Set(top)];
  return uniq.length ? `${uniq.join(" / ")} area` : "Nearby area";
}
