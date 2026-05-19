# Site Reliability Engineer

## Overview
A Site Reliability Engineer (SRE) applies software engineering to operations problems, treating reliability as a measurable feature rather than an afterthought. SREs define service level indicators and objectives (SLIs/SLOs) and error budgets, automate toil, run incident response and blameless postmortems, and engineer systems for scalability and resilience. The discipline originated at Google and emphasizes data-driven decisions about how much reliability is enough versus how fast to ship. SREs sit at the intersection of development and operations, owning production health, on-call practices, and the automation that keeps large-scale systems stable.

## Required Skills
- Strong coding ability (Python, Go) and solid data-structures/algorithms fluency
- Deep Linux internals, networking, and distributed-systems concepts (consensus, replication, caching, backpressure)
- SLI/SLO/error-budget design and reliability modeling
- Observability: metrics (Prometheus), tracing, logging, dashboards (Grafana), alerting strategy
- Incident command, on-call practices, and blameless postmortems
- Kubernetes and cloud infrastructure operations at scale
- Capacity planning, load testing, chaos engineering, and performance tuning
- Infrastructure as Code and automation to eliminate toil
- Production debugging and systems performance analysis

## Sub-roles / Specializations
- Observability Engineer (telemetry pipelines, metrics/tracing platforms)
- Reliability / Resilience Engineer (chaos engineering, failure testing)
- Capacity & Performance Engineer
- Incident / On-call Program Engineer
- Platform SRE (reliability of internal platforms and Kubernetes)
- Customer/Production Reliability Engineer (CRE)

## Salary Trend
US (USD, base): entry ~$110,000; mid ~$145,000-$175,000; senior ~$200,000-$300,000+ (staff/principal at large tech significantly higher with equity). India note: roughly INR 8-30 LPA depending on experience and employer tier. 2025-26 demand: high, and SRE typically pays a premium over generalist DevOps because of the engineering bar; large-scale platform, fintech, and AI-infrastructure companies are the strongest hirers, with growing emphasis on the reliability of ML/LLM serving systems.

## Learning Roadmap
**Beginner:** Build solid Linux, networking, and scripting skills; learn a real programming language (Python or Go) well enough to write tooling; understand what SLIs, SLOs, and error budgets mean; run a service and instrument it with basic metrics.
**Intermediate:** Learn Kubernetes operations and cloud infrastructure; build dashboards and alerting with Prometheus and Grafana; design SLOs for a real service and practice incident response; study distributed-systems failure modes (timeouts, retries, idempotency).
**Advanced:** Run game days and chaos experiments; do capacity planning and load testing; build automation that removes toil and enables self-healing; lead postmortems and reliability reviews; design multi-region resilience and graceful degradation; deepen distributed-systems knowledge.

## Learning Resources
- Google SRE Books — free books — https://sre.google/books/
- DevOps Roadmap — interactive roadmap — https://roadmap.sh/devops
- Kubernetes Documentation — official docs — https://kubernetes.io/docs/home/
- Prometheus Documentation — official docs — https://prometheus.io/docs/introduction/overview/
- The Art of SLOs — workshop materials — https://sre.google/resources/practices-and-processes/art-of-slos/
- Google Cloud Skills Boost — courses / certs — https://www.cloudskillsboost.google/
- Brendan Gregg — systems performance resources — https://www.brendangregg.com/
- Distributed Systems (van Steen & Tanenbaum) — free book — https://www.distributed-systems.net/index.php/books/ds3/

## Notes for Course Generation
Anchor the course in the Google SRE books and make SLO/error-budget thinking the conceptual core, not an afterthought. Include realistic incident simulations, postmortem-writing exercises, and chaos-engineering labs so learners practice judgment under failure. Assume a stronger coding prerequisite than a DevOps course; reference certifications such as CKA, Google Professional Cloud DevOps Engineer, and AWS DevOps Engineer – Professional while noting SRE is skills-led more than cert-led.
