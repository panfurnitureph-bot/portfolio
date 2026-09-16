// Fire-and-forget notification when users are @mentioned in a comment.
// Posts to an n8n webhook that emails the tagged users.
const N8N_MENTION_WEBHOOK_URL =
  (import.meta as any).env?.VITE_N8N_MENTION_WEBHOOK_URL ||
  "https://automation.example.invalid/webhook/comment-mention";

export interface MentionNotice {
  to: string;          // comma-separated emails of mentioned users
  commenter: string;   // who wrote the comment
  body: string;        // comment text
  recordRef: string;   // human reference (REF# / MBL)
  link: string;        // deep link to the record
}

export async function notifyMention(payload: MentionNotice): Promise<void> {
  if (!payload.to.trim()) return;
  try {
    await fetch(N8N_MENTION_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn("[notifyMention] webhook failed:", e);
  }
}
