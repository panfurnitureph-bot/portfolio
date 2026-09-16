"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Card } from "@/components/ui";
import { Modal } from "@/components/modal";
import { changePassword, type PasswordState } from "./actions";

const initial: PasswordState = { error: null, ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-primary/90 disabled:opacity-60"
    >
      {pending ? "Saving…" : "Update password"}
    </button>
  );
}

export function SecurityCard() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(changePassword, initial);

  // Close the dialog once the change succeeds.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold">Security</h2>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Password</p>
          <p className="text-xs text-muted">Change your account password.</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100"
        >
          Change Password
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <div>
          <p className="text-sm font-medium">Two-Factor Authentication</p>
          <p className="text-xs text-muted">Add an extra layer of security.</p>
        </div>
        <button
          disabled
          className="cursor-not-allowed rounded-lg px-4 py-2 text-sm font-medium text-muted ring-1 ring-inset ring-border"
        >
          Coming Soon
        </button>
      </div>

      {state.ok && (
        <p className="mt-4 text-sm text-success">Password updated.</p>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Change Password"
        description="Enter a new password for your account."
        size="sm"
      >
        <form action={formAction} className="space-y-4">
          <div>
            <label className="block text-sm font-medium" htmlFor="current">
              Current Password
            </label>
            <input
              id="current"
              name="current"
              type="password"
              autoComplete="current-password"
              className="mt-1.5 w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface"
            />
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="password">
              New Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="mt-1.5 w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface"
            />
            <p className="mt-1 text-xs text-muted">At least 8 characters.</p>
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="confirm">
              Confirm New Password
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="mt-1.5 w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface"
            />
          </div>

          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100"
            >
              Cancel
            </button>
            <SubmitButton />
          </div>
        </form>
      </Modal>
    </Card>
  );
}
