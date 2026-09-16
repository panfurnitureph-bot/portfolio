"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { audit, snapshot, auditAfter } from "@/lib/audit";

// Directory mutations are manager-gated (admin / operations_manager) — mirror
// app/hr/directory/actions.ts requireManager().
async function requireManager() {
  const me = await getSession();
  if (!me || !hasPermission(me, "hr_directory", "edit")) {
    throw new Error("Forbidden.");
  }
  return me;
}

// Persist a 128-float face descriptor (computed in the browser) for an employee.
export async function saveFaceDescriptor(
  employeeId: number,
  descriptor: number[],
  photo?: string | null,
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireManager();
    if (!employeeId) return { error: "Employee is required." };
    // Accept a single 128-float vector OR several concatenated (multi-sample enroll).
    if (
      !Array.isArray(descriptor) ||
      descriptor.length < 128 ||
      descriptor.length % 128 !== 0 ||
      descriptor.length > 128 * 8 ||
      descriptor.some((n) => typeof n !== "number" || !Number.isFinite(n))
    ) {
      return { error: "Invalid face descriptor — expected 128-float samples." };
    }
    // Sanity-bound the snapshot: must be a small JPEG/PNG data URL. Reject oddities
    // and anything too big to keep the row lean (~30 KB ceiling on the data URL).
    let face_photo: string | null = null;
    if (typeof photo === "string" && /^data:image\/(jpeg|png);base64,/.test(photo)) {
      face_photo = photo.length <= 60_000 ? photo : null;
    }
    const db = createServerSupabase();
    const before = await snapshot("employees", employeeId);
    const { error } = await db
      .from("employees")
      .update({ face_descriptor: descriptor, face_enrolled_at: new Date().toISOString(), ...(face_photo ? { face_photo } : {}) })
      .eq("id", employeeId);
    if (error) return { error: error.message };
    await auditAfter({ module: "employees", table: "employees", recordId: employeeId, action: "update", before, snapshotTable: "employees", snapshotId: employeeId });
    revalidatePath("/hr/directory");
    revalidatePath(`/hr/directory/${employeeId}`);
    revalidatePath("/hr/wfh");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to enroll face." };
  }
}

// Toggle whether an employee is an AUTHORIZED ENROLLER — i.e. their face can open
// the PIN-less, face-gated enroll panel at the kiosk. Manager-gated (admin/ops).
export async function setCanEnroll(
  employeeId: number,
  canEnroll: boolean,
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireManager();
    if (!employeeId) return { error: "Employee is required." };
    const db = createServerSupabase();
    const before = await snapshot("employees", employeeId);
    const { error } = await db.from("employees").update({ can_enroll: canEnroll }).eq("id", employeeId);
    if (error) return { error: error.message };
    await auditAfter({ module: "employees", table: "employees", recordId: employeeId, action: "update", before, snapshotTable: "employees", snapshotId: employeeId });
    revalidatePath("/hr/directory");
    revalidatePath(`/hr/directory/${employeeId}`);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update enroller permission." };
  }
}

// Un-enroll: clear the descriptor + enrolled timestamp.
export async function clearFaceDescriptor(
  employeeId: number,
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireManager();
    if (!employeeId) return { error: "Employee is required." };
    const db = createServerSupabase();
    const before = await snapshot("employees", employeeId);
    const { error } = await db
      .from("employees")
      .update({ face_descriptor: null, face_enrolled_at: null, face_photo: null })
      .eq("id", employeeId);
    if (error) return { error: error.message };
    await auditAfter({ module: "employees", table: "employees", recordId: employeeId, action: "update", before, snapshotTable: "employees", snapshotId: employeeId });
    revalidatePath("/hr/directory");
    revalidatePath(`/hr/directory/${employeeId}`);
    revalidatePath("/hr/wfh");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to clear face enrollment." };
  }
}
