# Tech Careers Knowledge Base

A researched knowledge base of tech-industry career paths, built to feed the
**Saidrix course-maker agent**. Each file is a detailed, English-language profile
covering: Overview, Required Skills, Sub-roles, Salary Trend (US + India + 2025–26
demand), a Beginner → Intermediate → Advanced learning roadmap, 6–10 vetted
learning resources with links, and notes on how to turn it into a course.

**33 career profiles across 6 domains.**

---

## Software & Development
- [Software Engineer](software-engineer.md)
- [Frontend Developer](frontend-developer.md)
- [Backend Developer](backend-developer.md)
- [Full-Stack Developer](full-stack-developer.md)
- [Mobile Developer](mobile-developer.md)
- [Game Developer](game-developer.md)
- [Embedded / Firmware Engineer](embedded-firmware-engineer.md)

## Data & AI
- [Data Analyst](data-analyst.md)
- [Data Scientist](data-scientist.md)
- [Data Engineer](data-engineer.md)
- [Machine Learning Engineer](machine-learning-engineer.md)
- [AI / LLM Engineer](ai-llm-engineer.md)
- [Business Intelligence Analyst](business-intelligence-analyst.md)

## Infrastructure, Cloud & Operations
- [DevOps Engineer](devops-engineer.md)
- [Site Reliability Engineer (SRE)](site-reliability-engineer.md)
- [Cloud Engineer](cloud-engineer.md)
- [Systems Administrator](systems-administrator.md)
- [Network Engineer](network-engineer.md)
- [Database Administrator (DBA)](database-administrator.md)

## Cybersecurity
- [Cybersecurity Analyst (SOC)](cybersecurity-analyst.md)
- [Penetration Tester / Ethical Hacker](penetration-tester.md)
- [Security Engineer](security-engineer.md)
- [GRC / Compliance Analyst](grc-compliance-analyst.md)

## Product, Design & Management
- [Product Manager](product-manager.md)
- [UX / UI Designer](ux-ui-designer.md)
- [UX Researcher](ux-researcher.md)
- [Technical Program Manager](technical-program-manager.md)
- [Engineering Manager](engineering-manager.md)

## QA & Emerging / Specialized
- [QA / Test Automation Engineer](qa-test-automation-engineer.md)
- [Blockchain / Web3 Developer](blockchain-web3-developer.md)
- [AR / VR / XR Developer](ar-vr-xr-developer.md)
- [Technical Writer](technical-writer.md)
- [Developer Relations (DevRel)](developer-relations.md)

---

## How to use with the course-maker agent

Each profile is structured so the course-maker agent can consume it directly:

- **`## Overview` + `## Sub-roles`** → scope a course and decide specialization tracks.
- **`## Required Skills`** → derive course chapters/modules and prerequisites.
- **`## Learning Roadmap`** → map directly to Beginner / Intermediate / Advanced
  course levels (mirrors the agent's Course → Chapter → Module hierarchy).
- **`## Learning Resources`** → seed the RAG `KnowledgeDoc` store and cite as
  further-reading in generated lectures.
- **`## Notes for Course Generation`** → a ready-made prompt hint: suggested
  module breakdown, prerequisites, and capstone project per career.

Suggested ingestion: load each file as a `KnowledgeDoc` (subject = career name,
tags = domain) so `rag_search` can retrieve it during course generation.

**Caveats:** Salary figures are 2025–26 US ranges (USD) with India context;
treat as directional, not exact. Resource URLs are canonical/stable; re-verify
periodically as platforms change.
