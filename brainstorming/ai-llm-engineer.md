# AI / LLM Engineer

## Overview
An AI / LLM Engineer designs and ships applications powered by large language models and other foundation models. Day-to-day work includes prompt engineering, building retrieval-augmented generation (RAG) systems, orchestrating agents and tools, fine-tuning or adapting models, and evaluating quality, cost, latency, and safety. The role combines applied ML, software engineering, and product thinking around generative AI, and increasingly emphasizes rigorous evaluation over clever prompting.

## Required Skills
- **Python & API integration** — strong scripting and service integration
- **Prompt engineering** — structured outputs, system design, robustness
- **LLM app frameworks** — LangChain, LlamaIndex, orchestration patterns
- **Retrieval-augmented generation** — embeddings, vector databases, chunking
- **Fine-tuning & adaptation** — LoRA/PEFT basics, when to fine-tune vs. RAG
- **Evaluation** — offline evals, guardrails, hallucination and regression checks
- **Agentic patterns** — tool use, function calling, multi-step workflows
- **Production concerns** — cost, latency, caching, safety / responsible AI

## Sub-roles / Specializations
- RAG / Search Engineer
- LLM Agents Engineer
- Applied AI / Prompt Engineer
- Fine-tuning / Model Adaptation Engineer
- AI Product Engineer (full-stack GenAI apps)
- AI Safety / Evaluation Engineer

## Salary Trend
US (USD): entry ~$130k; mid ~$160k–$190k; senior ~$220k–$350k+ (premium at frontier-AI firms). India: typically ₹10–35 LPA and rising at AI-focused companies. 2025–26 demand: among the fastest-growing in tech; experienced practitioner supply is limited, so even mid-level GenAI engineers command a premium, though expectations now extend beyond prompting to robust evaluation and production reliability.

## Learning Roadmap
**Beginner:** Python and REST APIs; LLM basics (tokens, context, temperature); effective prompting; calling a model API to build a simple app.
**Intermediate:** Embeddings and vector search; building a RAG pipeline; structured outputs and function/tool calling; basic evaluation of responses.
**Advanced:** Agentic workflows; fine-tuning with LoRA/PEFT; systematic LLM evaluation and guardrails; cost/latency optimization, caching, production safety and observability.

## Learning Resources
- Anthropic Documentation — docs / prompt engineering — https://docs.anthropic.com/
- OpenAI Cookbook — free recipes/repo — https://github.com/openai/openai-cookbook
- DeepLearning.AI Short Courses — free courses (RAG, agents) — https://www.deeplearning.ai/short-courses/
- Hugging Face Learn — free LLM/NLP courses — https://huggingface.co/learn
- LangChain Documentation — docs — https://python.langchain.com/docs/
- LlamaIndex Documentation — docs — https://docs.llamaindex.ai/
- Prompt Engineering Guide — website — https://www.promptingguide.ai/
- eugeneyan.com — applied LLM/ML blog — https://eugeneyan.com/

## Notes for Course Generation
Center the course on building one real GenAI application incrementally: API call → prompt design → RAG over a document set → tool-using agent → evaluation and guardrails. Prerequisites are solid Python and REST APIs; ML basics help but are not required. Heavily stress evaluation, cost, and reliability (not just prompts), since that is the field's maturity gap, and end with a capstone RAG-or-agent app shipped with an automated eval suite.
