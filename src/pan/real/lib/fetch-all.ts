// ANG 1000-ROW NA KISAME NG SUPABASE (2026-08-26).
//
// Ang hosted PostgREST ay may db-max-rows = 1000: kahit .limit(5000) ang
// hiniling, 1000 lang ang ibabalik — walang error, walang babala, putol lang.
// Lumitaw ito nang lumampas ang warehouse_locations sa 1000 (40 lines × 30
// cubics = 1,200): ang picker ay natapos sa L4-B4, ang ika-1000 na code sa
// pagkakasunod ng teksto.
//
// Ito ang pahina-pahinang kuha: bawat pahina ay range(i, i+999), hihinto sa
// unang maikling pahina. Gamitin ito sa alinmang table na maaaring lumampas
// sa 1000 na hilera.
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += size) {
    const { data, error } = await page(i, i + size - 1);
    if (error) break; // best-effort: ang nakuha na ang ibalik
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}
