// ===========================================
// Email templates
// Table-based + inline-CSS markup (the only thing
// Gmail / Outlook / Apple Mail render reliably).
// Dark-mode aware, mobile responsive, with a plain-
// text fallback for every HTML email.
// ===========================================

import { authConfig } from "../config/auth.config.js";

// Saidrix brand — dark UI with the signature green accent. Email clients
// strip web fonts (Anton/Space Grotesk), so we approximate the look with
// bold uppercase headings + a monospace stack for codes.
const BRAND = {
  name: "Saidrix",
  tagline: "AI TUTOR",
  accent: "#2DFD7E", // signature green
  accentInk: "#0A1A0F", // text on green
  ink: "#FFFFFF", // headings
  body: "#D6D6D4", // body text
  muted: "#8A8A87", // secondary text
  faint: "#5E5E5C", // footer / fine print
  bg: "#0A0A09", // page background
  card: "#18181A", // card surface (lifted off the page)
  codeBg: "#0E1F15", // code panel — subtle green tint
  border: "#33332F", // hairline borders
  codeBorder: "#244A31", // code panel border (green-tinted)
};

const MONO = "'JetBrains Mono','SFMono-Regular',Consolas,'Courier New',monospace";
const SANS = "system-ui,'Segoe UI',Arial,sans-serif";

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
         style="background:${BRAND.bg};padding:44px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:460px;width:100%;">
          <!-- Brand (centered) -->
          <tr>
            <td align="center" style="padding:0 0 26px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:40px;height:40px;background:${BRAND.accent};
                             border-radius:9px;text-align:center;vertical-align:middle;
                             font:800 21px/40px ${SANS};color:${BRAND.accentInk};">S</td>
                  <td style="padding-left:11px;vertical-align:middle;text-align:left;">
                    <div style="font:700 19px ${SANS};letter-spacing:.5px;color:${BRAND.ink};">${BRAND.name}</div>
                    <div style="font:700 9px ${MONO};letter-spacing:2.5px;color:${BRAND.accent};margin-top:3px;">${BRAND.tagline}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Card with green top accent -->
          <tr>
            <td style="background:${BRAND.card};border:1px solid ${BRAND.border};
                       border-radius:16px;overflow:hidden;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="height:4px;background:${BRAND.accent};font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding:38px 36px 42px;">
                    ${bodyHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:26px 12px 0;text-align:center;
                       font:12px/1.7 ${SANS};color:${BRAND.faint};">
              <span style="color:${BRAND.muted};font-weight:700;">${BRAND.name}</span>
              &nbsp;·&nbsp; ${BRAND.tagline}<br>
              You received this email because someone used this address to sign up.
              If that wasn't you, you can safely ignore it.<br>
              <span style="color:${BRAND.faint};">&copy; ${year} ${BRAND.name}</span>
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
  const spaced = String(code).split("").join("&nbsp;");

  const subject = `${code} is your ${BRAND.name} verification code`;

  const text =
    `Hi ${name || "there"},\n\n` +
    `Welcome to ${BRAND.name}! Use this code to verify your email:\n\n` +
    `    ${code}\n\n` +
    `This code expires in ${minutes} minutes. ` +
    `If you didn't request it, you can ignore this email.\n\n` +
    `— The ${BRAND.name} team`;

  const bodyHtml = `
    <div style="font:700 10px ${MONO};letter-spacing:2.5px;text-transform:uppercase;
                color:${BRAND.accent};margin:0 0 14px;">Account Verification</div>
    <h1 style="margin:0 0 12px;font:700 24px ${SANS};letter-spacing:.3px;
               text-transform:uppercase;color:${BRAND.ink};">Verify your email</h1>
    <p style="margin:0 0 26px;font:15px/1.65 ${SANS};color:${BRAND.body};">
      Hi ${safeName}, welcome to ${BRAND.name}. Enter the code below to finish
      setting up your account.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center"
            style="background:${BRAND.codeBg};border:1px solid ${BRAND.codeBorder};
                   border-radius:12px;padding:26px 0;">
          <div style="font:700 36px/1 ${MONO};letter-spacing:3px;color:${BRAND.accent};">
            ${spaced}
          </div>
        </td>
      </tr>
    </table>

    <p style="margin:24px 0 0;font:13px/1.65 ${SANS};color:${BRAND.muted};">
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

// --- Generic 6-digit code email (re-used for password/email change) ----

const CODE_COPY = {
  change_password: {
    eyebrow: "Password Change",
    heading: "Confirm your new password",
    intro:
      "Use the code below to confirm the password change. If you didn't request this, you can safely ignore this email.",
    subjectPrefix: "Confirm your password change",
  },
  change_email: {
    eyebrow: "Email Change",
    heading: "Confirm your new email",
    intro:
      "Use the code below to confirm this as your new account email. If you didn't request this, you can safely ignore this email.",
    subjectPrefix: "Confirm your email change",
  },
};

export function codeEmail({ name, code, purpose }) {
  const copy = CODE_COPY[purpose] || CODE_COPY.change_password;
  const safeName = name ? escapeHtml(name) : "there";
  const minutes = Math.round(authConfig.verification.codeTtlMs / 60000);
  const spaced = String(code).split("").join("&nbsp;");
  const subject = `${code} · ${copy.subjectPrefix}`;

  const text =
    `Hi ${name || "there"},\n\n` +
    `${copy.intro}\n\n` +
    `    ${code}\n\n` +
    `This code expires in ${minutes} minutes.\n\n` +
    `— The ${BRAND.name} team`;

  const bodyHtml = `
    <div style="font:700 10px ${MONO};letter-spacing:2.5px;text-transform:uppercase;
                color:${BRAND.accent};margin:0 0 14px;">${escapeHtml(copy.eyebrow)}</div>
    <h1 style="margin:0 0 12px;font:700 24px ${SANS};letter-spacing:.3px;
               text-transform:uppercase;color:${BRAND.ink};">${copy.heading}</h1>
    <p style="margin:0 0 26px;font:15px/1.65 ${SANS};color:${BRAND.body};">
      Hi ${safeName}, ${copy.intro}
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center"
            style="background:${BRAND.codeBg};border:1px solid ${BRAND.codeBorder};
                   border-radius:12px;padding:26px 0;">
          <div style="font:700 36px/1 ${MONO};letter-spacing:3px;color:${BRAND.accent};">
            ${spaced}
          </div>
        </td>
      </tr>
    </table>

    <p style="margin:24px 0 0;font:13px/1.65 ${SANS};color:${BRAND.muted};">
      This code expires in <strong style="color:${BRAND.ink};">${minutes} minutes</strong>.
      For your security, never share it with anyone.
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

// --- Support ticket forward email (admin-bound) ------------------------

export function supportTicketEmail({ fromName, fromEmail, subject, message }) {
  const safeName = escapeHtml(fromName || fromEmail || "user");
  const safeEmail = escapeHtml(fromEmail || "");
  const safeSubject = escapeHtml(subject || "(no subject)");
  const safeMessage = escapeHtml(message || "").replace(/\n/g, "<br>");

  const out = {
    subject: `[Support] ${subject || "(no subject)"}`,
    text:
      `New support request from ${fromName || fromEmail}\n` +
      `Email: ${fromEmail}\n` +
      `Subject: ${subject || "(no subject)"}\n\n` +
      `${message || ""}\n`,
    html: layout({
      preheader: `New support request from ${fromName || fromEmail}`,
      heading: "Support request",
      bodyHtml: `
        <div style="font:700 10px ${MONO};letter-spacing:2.5px;text-transform:uppercase;
                    color:${BRAND.accent};margin:0 0 14px;">Support Request</div>
        <h1 style="margin:0 0 16px;font:700 24px ${SANS};letter-spacing:.3px;
                   text-transform:uppercase;color:${BRAND.ink};">New support request</h1>
        <p style="margin:0 0 16px;font:14px/1.6 ${SANS};color:${BRAND.muted};">
          <strong style="color:${BRAND.ink};">From:</strong> ${safeName} &lt;${safeEmail}&gt;<br>
          <strong style="color:${BRAND.ink};">Subject:</strong> ${safeSubject}
        </p>
        <div style="background:${BRAND.codeBg};border:1px solid ${BRAND.border};
                    border-radius:12px;padding:20px 22px;font:14px/1.7 ${SANS};color:${BRAND.body};">
          ${safeMessage}
        </div>`,
    }),
  };
  return out;
}

export default { verificationEmail, codeEmail, supportTicketEmail };
