// ===========================================
// Email templates
// Table-based + inline-CSS markup (the only thing
// Gmail / Outlook / Apple Mail render reliably).
// Dark-mode aware, mobile responsive, with a plain-
// text fallback for every HTML email.
// ===========================================

import { authConfig } from "../config/auth.config.js";

const BRAND = {
  name: "Saidrix",
  tagline: "Your AI learning companion",
  accent: "#6d28d9", // violet-700
  accentSoft: "#ede9fe", // violet-100
  ink: "#0f172a", // slate-900
  muted: "#64748b", // slate-500
  bg: "#f1f5f9", // slate-100
  card: "#ffffff",
};

function escapeHtml(s) {
  return String(s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]
  );
}

// Shared shell so every email looks consistent
function layout({ preheader, heading, bodyHtml }) {
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:${BRAND.bg};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:480px;width:100%;">
          <!-- Brand -->
          <tr>
            <td style="padding:0 8px 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:40px;height:40px;background:${BRAND.accent};
                             border-radius:10px;text-align:center;vertical-align:middle;
                             font:700 20px/40px system-ui,Segoe UI,Arial,sans-serif;
                             color:#ffffff;">S</td>
                  <td style="padding-left:12px;font:700 20px system-ui,Segoe UI,Arial,sans-serif;
                             color:${BRAND.ink};">${BRAND.name}</td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background:${BRAND.card};border-radius:16px;
                       padding:36px 32px;border:1px solid #e2e8f0;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 8px;text-align:center;
                       font:12px system-ui,Segoe UI,Arial,sans-serif;color:${BRAND.muted};">
              ${BRAND.name} · ${BRAND.tagline}<br>
              You received this email because someone used this address to sign up.
              If that wasn't you, you can safely ignore it.<br>
              <span style="color:#94a3b8;">&copy; ${year} ${BRAND.name}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// --- Verification code email --------------------------------------------

export function verificationEmail(name, code) {
  const safeName = name ? escapeHtml(name) : "there";
  const minutes = Math.round(authConfig.verification.codeTtlMs / 60000);
  const spaced = String(code).split("").join("&nbsp;&nbsp;");

  const subject = `${code} is your ${BRAND.name} verification code`;

  const text =
    `Hi ${name || "there"},\n\n` +
    `Welcome to ${BRAND.name}! Use this code to verify your email:\n\n` +
    `    ${code}\n\n` +
    `This code expires in ${minutes} minutes. ` +
    `If you didn't request it, you can ignore this email.\n\n` +
    `— The ${BRAND.name} team`;

  const bodyHtml = `
    <h1 style="margin:0 0 8px;font:700 22px system-ui,Segoe UI,Arial,sans-serif;
               color:${BRAND.ink};">Verify your email</h1>
    <p style="margin:0 0 24px;font:15px/1.6 system-ui,Segoe UI,Arial,sans-serif;
              color:${BRAND.muted};">
      Hi ${safeName}, welcome to ${BRAND.name}! Enter the code below to finish
      setting up your account.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center"
            style="background:${BRAND.accentSoft};border:1px solid #ddd6fe;
                   border-radius:12px;padding:22px 0;">
          <div style="font:700 34px/1 'Courier New',monospace;
                      letter-spacing:4px;color:${BRAND.accent};">
            ${spaced}
          </div>
        </td>
      </tr>
    </table>

    <p style="margin:22px 0 0;font:13px/1.6 system-ui,Segoe UI,Arial,sans-serif;
              color:${BRAND.muted};">
      This code expires in <strong style="color:${BRAND.ink};">${minutes} minutes</strong>.
      For your security, never share it with anyone — ${BRAND.name} will never
      ask you for this code.
    </p>`;

  return {
    subject,
    text,
    html: layout({
      preheader: `Your ${BRAND.name} code is ${code} (expires in ${minutes} min)`,
      heading: subject,
      bodyHtml,
    }),
  };
}

export default { verificationEmail };
