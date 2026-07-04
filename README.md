# AgentEval

AgentEval is a behavioral reliability evaluator for AI agents.

The core thesis is simple: an agent can sound aligned while acting unreliably. AgentEval measures whether an agent's behavior matches its language, with a focus on promise-action gaps, strategic masking, and behavior-language misalignment.

## Why this exists

Most agent demos optimize for capability and polish. Far fewer tools evaluate whether an agent:

- follows instructions consistently
- keeps its commitments across steps
- surfaces uncertainty honestly
- avoids strategic language that hides weak behavior

This project turns those questions into an evaluable product surface.

## Research backing

AgentEval grows out of a multi-agent Public Goods Game (PGG) project on LLM cooperation and deception:

- 1,350 round-level observations
- 9 behavioral personas
- 11 algorithmic monitoring and enforcement mechanisms
- a central result that deceptive agents can sound normal while defecting
- a repeated style-vs-substance gap in language-based monitoring

The research framing is:

> How should we design low-cost monitoring mechanisms that sustain cooperation among LLM agents, especially when agents can strategically manipulate language-based signals?

That same problem becomes a product thesis:

> How do we evaluate whether an AI agent's actions actually match what it says it is doing?

## Product wedge

The initial wedge is a simple web app:

`paste agent trace -> evaluate -> reliability report`

The MVP report should score:

- instruction following
- consistency across steps
- commitment-action alignment
- hallucination or unsupported-claim risk
- behavior-language alignment
- strategic masking risk
- overall reliability

## Current MVP

The repository now includes a working `Next.js + Tailwind` MVP with:

- a one-page landing and demo interface
- sample traces for reliable, hallucinatory, and strategically masking agents
- a server-side `/api/evaluate` route
- an OpenAI-powered evaluator when `OPENAI_API_KEY` is set
- a heuristic fallback mode so the demo still works locally without a key

## Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Optional environment variables:

```bash
cp .env.example .env.local
```

- `OPENAI_API_KEY`: enables LLM-as-judge scoring
- `OPENAI_MODEL`: optional override, defaults to `gpt-4.1-mini`

Basic verification:

```bash
npm run typecheck
npm run test
npm run build
```

## Project Structure

- `app/`: Next.js app router pages, styles, and API route
- `components/`: client UI for the demo and report rendering
- `lib/`: sample traces, evaluation schema, heuristic scoring, and OpenAI integration
- `docs/`: positioning, bridge docs, and startup-facing product notes

The separate PGG research repository can be linked alongside this app, but it is not required to run the MVP.

## Positioning

For startup applications and outreach, the ordering is:

1. builder credibility
2. research credibility
3. theoretical depth

PGG provides the research credibility.
AgentEval provides the builder credibility.
Lightweight algorithmic game theory framing strengthens the story without slowing down shipping.

## Docs

- [Startup positioning](./docs/startup-positioning.md)
- [Research-to-product bridge](./docs/research-to-product-bridge.md)
- [Web app MVP spec](./docs/webapp-mvp-spec.md)
- [Application and demo copy](./docs/application-and-demo-copy.md)
- [Deploy to Vercel](./docs/deploy-vercel.md)
