// ===========================================
// Preview the verification email in a browser.
//
//   node scripts/preview-email.mjs
//
// Renders the template to scripts/email-preview.html
// and prints the path — open it in any browser to
// review the design without sending a real email.
// ===========================================

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { verificationEmail } from "../src/utils/emailTemplates.js";

const here = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] || "Sifuddin";
const code = process.argv[3] || "428913";

const { subject, html } = verificationEmail(name, code);
const out = join(here, "email-preview.html");
writeFileSync(out, html);

console.log(`Subject: ${subject}`);
console.log(`Rendered -> ${out}`);
console.log("Open that file in a browser to preview the design.");
