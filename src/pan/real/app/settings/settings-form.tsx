"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Card } from "@/components/ui";
import { ROLE_LABEL, type Role } from "@/lib/auth/rbac";
import { signOut } from "@/lib/auth/actions";
import { AvatarUpload } from "./avatar-upload";
import { updateProfileName, type ProfileState } from "./actions";

const initial: ProfileState = { error: null, ok: false };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-primary/90 disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export function SettingsForm({
  userId,
  fullName,
  email,
  role,
  avatarUrl,
}: {
  userId: string;
  fullName: string;
  email: string;
  role: Role;
  avatarUrl: string | null;
}) {
  const [state, formAction] = useActionState(updateProfileName, initial);

  return (
    <Card className="p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <AvatarUpload userId={userId} fullName={fullName} avatarUrl={avatarUrl} />
        <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-muted">
          {ROLE_LABEL[role]}
        </span>
      </div>

      <form action={formAction} className="space-y-4">
        <div>
          <label className="block text-sm font-medium" htmlFor="full_name">
            Full Name
          </label>
          <input
            id="full_name"
            name="full_name"
            defaultValue={fullName}
            required
            maxLength={120}
            className="mt-1.5 w-full max-w-md rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface"
          />
        </div>

        <div>
          <label className="block text-sm font-medium" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            value={email}
            disabled
            className="mt-1.5 w-full max-w-md cursor-not-allowed rounded-lg border border-border bg-stone-100 px-3 py-2 text-sm text-muted"
          />
          <p className="mt-1 text-xs text-muted">Contact support to change your email.</p>
        </div>

        <div className="flex items-center gap-3">
          <SaveButton />
          {state.ok && <span className="text-sm text-success">Saved.</span>}
          {state.error && <span className="text-sm text-danger">{state.error}</span>}
        </div>
      </form>

      <div className="mt-6 border-t border-border pt-4">
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-lg px-4 py-2 text-sm font-medium text-danger ring-1 ring-inset ring-red-600/20 hover:bg-red-50"
          >
            Sign out
          </button>
        </form>
      </div>
    </Card>
  );
}
