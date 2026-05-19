// ===========================================
// scripts/ingestKnowledge.js
//
// Seeds the KnowledgeDoc RAG collection from the tech-career profiles
// in `brainstorming/*.md`. Idempotent: upserts by a deterministic
// docId, so re-running updates instead of duplicating.
//
//   node scripts/ingestKnowledge.js
// ===========================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { connectDB } from "../src/db/connection.js";
import KnowledgeDoc from "../src/db/models/KnowledgeDoc.js";
import logger from "../src/utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, "..", "brainstorming");

// Filename (without .md) → domain. Mirrors brainstorming/README.md grouping.
const DOMAIN = {
  "software-engineer": "Software & Development",
  "frontend-developer": "Software & Development",
  "backend-developer": "Software & Development",
  "full-stack-developer": "Software & Development",
  "mobile-developer": "Software & Development",
  "game-developer": "Software & Development",
  "embedded-firmware-engineer": "Software & Development",
  "data-analyst": "Data & AI",
  "data-scientist": "Data & AI",
  "data-engineer": "Data & AI",
  "machine-learning-engineer": "Data & AI",
  "ai-llm-engineer": "Data & AI",
  "business-intelligence-analyst": "Data & AI",
  "devops-engineer": "Infrastructure, Cloud & Operations",
  "site-reliability-engineer": "Infrastructure, Cloud & Operations",
  "cloud-engineer": "Infrastructure, Cloud & Operations",
  "systems-administrator": "Infrastructure, Cloud & Operations",
  "network-engineer": "Infrastructure, Cloud & Operations",
  "database-administrator": "Infrastructure, Cloud & Operations",
  "cybersecurity-analyst": "Cybersecurity",
  "penetration-tester": "Cybersecurity",
  "security-engineer": "Cybersecurity",
  "grc-compliance-analyst": "Cybersecurity",
  "product-manager": "Product, Design & Management",
  "ux-ui-designer": "Product, Design & Management",
  "ux-researcher": "Product, Design & Management",
  "technical-program-manager": "Product, Design & Management",
  "engineering-manager": "Product, Design & Management",
  "qa-test-automation-engineer": "QA & Emerging",
  "blockchain-web3-developer": "QA & Emerging",
  "ar-vr-xr-developer": "QA & Emerging",
  "technical-writer": "QA & Emerging",
  "developer-relations": "QA & Emerging",
};

// First "# Heading" line → human-readable career name.
function parseTitle(md, fallback) {
  const m = md.match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : fallback;
}

async function main() {
  if (!fs.existsSync(KB_DIR)) {
    logger.error(`[ingest] Knowledge dir not found: ${KB_DIR}`);
    process.exit(1);
  }

  await connectDB();

  const files = fs
    .readdirSync(KB_DIR)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md");

  if (files.length === 0) {
    logger.error(`[ingest] No career .md files in ${KB_DIR}`);
    process.exit(1);
  }

  let upserted = 0;
  for (const file of files) {
    const slug = file.replace(/\.md$/i, "");
    const content = fs.readFileSync(path.join(KB_DIR, file), "utf8");
    const title = parseTitle(content, slug);
    const domain = DOMAIN[slug] || "Tech Careers";

    await KnowledgeDoc.updateOne(
      { docId: `career:${slug}` },
      {
        $set: {
          docId: `career:${slug}`,
          subject: title,
          title: `${title} — Career Profile`,
          content,
          source: `brainstorming/${file}`,
          tags: ["tech-career", domain, title],
          metadata: { kind: "career-profile", domain, slug },
        },
      },
      { upsert: true }
    );
    upserted += 1;
    logger.info(`[ingest] upserted: ${title} (${domain})`);
  }

  const total = await KnowledgeDoc.countDocuments();
  logger.info(
    `[ingest] Done. ${upserted} career profiles upserted. KnowledgeDoc total: ${total}`
  );

  await mongoose.connection.close().catch(() => {});
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[ingest] Failed: ${err.message}`);
  process.exit(1);
});
