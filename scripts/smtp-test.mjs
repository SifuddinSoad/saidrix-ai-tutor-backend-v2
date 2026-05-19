// ===========================================
// One-off Brevo SMTP check.
//   node scripts/smtp-test.mjs [recipient]
// 1) verifies SMTP auth/connectivity (no email sent)
// 2) sends ONE real verification-style email so we can
//    confirm the sender domain is authenticated in Brevo.
// ===========================================

import 'dotenv/config';
import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT) || 587;
const secure = String(process.env.SMTP_SECURE).toLowerCase() === 'true';
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.MAIL_FROM;
const to = process.argv[2] || 'sifuddinsoad@gmail.com';

console.log(`SMTP host=${host}:${port} secure=${secure} user=${user ? user.slice(0, 6) + '…' : '(none)'}`);
console.log(`from=${from}  to=${to}`);

const transport = nodemailer.createTransport({
  host, port, secure,
  auth: user ? { user, pass } : undefined,
  connectionTimeout: 12000,
  greetingTimeout: 12000,
});

try {
  await transport.verify();
  console.log('✅ verify() OK — SMTP credentials + connection valid');
} catch (err) {
  console.log(`❌ verify() FAILED: ${err.message}`);
  process.exit(2);
}

try {
  const info = await transport.sendMail({
    from,
    to,
    subject: 'Saidrix SMTP test',
    text: 'If you received this, Brevo SMTP + sender domain are working.',
  });
  console.log(`✅ send OK — messageId=${info.messageId}`);
  console.log(`   accepted=${JSON.stringify(info.accepted)} rejected=${JSON.stringify(info.rejected)}`);
} catch (err) {
  console.log(`❌ send FAILED: ${err.message}`);
  console.log('   (Most common cause: sender domain not authenticated in Brevo → Senders & Domains)');
  process.exit(3);
}
