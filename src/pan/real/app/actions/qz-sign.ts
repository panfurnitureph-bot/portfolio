"use server";

import crypto from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

// Sign a QZ Tray request payload with our private key so QZ trusts it silently
// (no "Allow" prompt). The private key never leaves the server.
//
// The key is read from the QZ_PRIVATE_KEY env var (required in production — the
// certs/ file is gitignored and NOT deployed to Vercel, which is why signing
// failed there). Falls back to the local certs/private-key.pem for dev. When the
// env var holds the PEM with literal "\n" escapes (common when pasting into a
// dashboard) we normalise them back to real newlines.
let cachedKey: string | null = null;
function privateKey(): string {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.QZ_PRIVATE_KEY;
  if (fromEnv && fromEnv.trim()) {
    // BINUBUO MULING ANG PEM, HINDI PINAPALAGAY ANG ANYO (2026-08-28). Tatlong
    // paraan ang inaabot nito sa server, at dalawa lang ang naiintindihan noon:
    //   1. tunay na newline    — kapag pinapayagan ng dashboard ang multi-line
    //   2. literal na "\\n"    — kapag isang linya ang kaya lang
    //   3. WALANG newline      — kapag tinanggal ng platform ang mga ito
    // Ang pangatlo ay tinatanggihan ng OpenSSL at nauuwi sa 500 na walang
    // paliwanag. Kaya kinukuha na lang ang base64 sa gitna at muling binubuo ang
    // PEM sa tamang hugis: 64 char kada linya, may header at footer.
    const raw = fromEnv.replace(/\\n/g, "\n").replace(/\r/g, "");
    const body = raw
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "")
      .replace(/-----END [A-Z ]*PRIVATE KEY-----/, "")
      .replace(/[^A-Za-z0-9+/=]/g, "");
    const label = /BEGIN RSA PRIVATE KEY/.test(raw) ? "RSA PRIVATE KEY" : "PRIVATE KEY";
    const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
    cachedKey = `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
    return cachedKey;
  }
  // Dev fallback: the PEM file in the repo (present locally, ignored by git).
  //
  // WALANG PEM SA SERVER (2026-08-28). Ang certs/private-key.pem ay gitignored,
  // kaya wala ito sa Hostinger — at ang readFileSync ay nagtatapon ng ENOENT na
  // nagiging 500. Ang nakikita ng tao ay "Failed to sign request", na parang
  // sira ang QZ Tray gayong konektado naman ito. Sabihin kung ano talaga.
  try {
    cachedKey = readFileSync(join(process.cwd(), "certs", "private-key.pem"), "utf8");
    return cachedKey;
  } catch {
    throw new Error(
      "QZ_PRIVATE_KEY is not set on this server, and certs/private-key.pem is not deployed "
      + "(it is gitignored). Paste the PEM into QZ_PRIVATE_KEY in the environment.",
    );
  }
}

export async function signQz(toSign: string): Promise<string> {
  try {
    const signer = crypto.createSign("SHA512");
    signer.update(toSign);
    signer.end();
    return signer.sign(privateKey(), "base64");
  } catch (e) {
    // Surface a clear reason instead of the opaque "Failed to sign request".
    const msg = e instanceof Error ? e.message : String(e);
    // Ang mensahe ng nawawalang susi ay kumpleto na — huwag nang balutin muli.
    if (/QZ_PRIVATE_KEY/.test(msg)) throw new Error(msg);
    throw new Error(`QZ signing failed — ${msg}`);
  }
}
