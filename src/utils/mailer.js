// ===========================================
// Mailer
// Nodemailer SMTP transport + branded templates.
// When SMTP is not configured (no SMTP_HOST) we fall
// back to dev mode: the verification code is logged
// instead of sent, so the signup flow works locally
// with zero email setup. In production a missing SMTP
// config is a hard error.
// ===========================================

import nodemailer from "nodemailer";
import { authConfig } from "../config/auth.config.js";
import { verificationEmail } from "./emailTemplates.js";
import logger from "./logger.js";

const { smtp, from } = authConfig.mail;

let transport = null;
const SMTP_ENABLED = Boolean(smtp.host);

if (SMTP_ENABLED) {
  transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure, // true => implicit TLS (465), false => STARTTLS (587)
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    pool: true,
    maxConnections: 3,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  // Non-fatal connectivity check so a bad SMTP config is visible at boot
  transport
    .verify()
    .then(() => logger.info(`[mailer] SMTP ready (${smtp.host}:${smtp.port})`))
    .catch((err) =>
      logger.error(`[mailer] SMTP verify failed: ${err.message}`)
    );
} else {
  logger.warn(
    "[mailer] SMTP not configured — verification codes will be logged (dev mode only)"
  );
}

// Send a signup verification code. In dev (no SMTP) this logs the code.
export async function sendVerificationEmail(to, name, code) {
  if (!SMTP_ENABLED) {
    if (!authConfig.isProd) {
      logger.info(`[mailer:dev] verification code for ${to}: ${code}`);
      return;
    }
    logger.error(
      "[mailer] SMTP not configured in production — cannot send verification email"
    );
    throw new Error("Email delivery is not configured");
  }

  const { subject, text, html } = verificationEmail(name, code);

  await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
    headers: { "X-Entity-Ref-ID": "saidrix-verification" },
  });

  logger.info(`[mailer] verification email sent to ${to}`);
}

export default { sendVerificationEmail };
