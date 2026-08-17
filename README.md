# AgentEval

**Evidence-linked evaluation of whether an agent trace supports its own claims.**

[Live demo](https://agenteval-eight.vercel.app) | [Evaluation protocol](docs/evaluation-protocol.md) | [Benchmark v1 status](docs/benchmark-v1.md) | [Research brief](docs/research-brief.md)

AgentEval normalizes an AI-agent trace, runs bounded diagnostic checks, and returns a behavioral-reliability report. It evaluates only observable trace evidence. Its findings are rubric-based signals: they are not calibrated probabilities, judgments about hidden intent, or proof that an external action occurred outside the supplied trace.

## Current status

| Area | Status | What that status means |
| --- | --- | --- |
| Canonical structured traces | Implemented and covered by automated tests | Legacy text, generic JSON, and OpenAI Responses data normalize to a versioned event model with identity, status, source pointers, provenance, pairing diagnostics, and default secret redaction. |
| Provenance-aware claim support | Implemented and covered by automated tests | Structured claims require explicitly linked, successful `recorded` or `verified` evidence. Failed, unknown-status, unrelated, and `declared`-only events are rejected as canonical support. |
| Adaptive evaluator | Implemented and covered with mocked model-loop tests | The Responses API loop begins with structural inspection, selects from six read-only diagnostics, stops at an evidence decision or a six-step limit, and uses deterministic server-side overall-score weights. |
| Fail-closed research and ops modes | Implemented and covered by automated tests | `research-eval` and `ops-reliability` return an error when the model is unavailable or fails; they do not silently substitute a heuristic report. |
| Run telemetry | Implemented and covered by automated tests | Reports carry input and version identifiers, requested/returned models, per-call status/latency/token fields, tool/model call counts, wall/model/tool time, fallback policy, and degradation state. |
| Benchmark v1 data scaffold | Candidate-ready, not scoring-ready | Deterministic checks pass for the committed 84-case scaffold, but every proposed annotation still requires independent human review. No accepted test labels or benchmark performance results exist. |
| Human annotation and locked test release | Future work | Candidates must be independently annotated, disagreements resolved, integrity checks rerun, and labels isolated before test scoring. |
| Paid-model comparison study | Future work | The planned four-way evaluator comparison has not been run. No accuracy, latency, token, or cost conclusion is claimed. |

## Evaluation pipeline

```text
submitted trace
    -> normalize and redact
    -> pair tool calls/results by explicit identity
    -> hash the normalized evaluation input
    -> inspect structure
    -> adaptively select diagnostic tools
    -> synthesize rubric scores and evidence
    -> compute overall reliability on the server
    -> attach run metadata and degradation state
```

The canonical trace schema (`1.0.0`) represents `message`, `tool_call`, `tool_result`, `artifact`, `error`, and `state_change` events. Each event retains an ID, sequence, source pointer, status, and one of three provenance levels:

- `declared`: asserted in prose or supplied without execution evidence;
- `recorded`: emitted through a structured runtime or tool transport, but not independently checked;
- `verified`: checked by a trusted verifier under the ingestion policy.

Plain-text traces remain supported for demo compatibility, but their events are `declared` and their proximity-based alignment is explicitly marked as a degraded, lossy fallback. See [Structured traces and provenance](docs/structured-traces.md) for the data contract and trust boundary.

## Evaluator behavior

The implemented model-driven evaluator has six local, read-only diagnostics:

- trace structure inspection;
- commitment and claim extraction;
- execution-evidence inspection;
- claim/action alignment by explicit event identity;
- observable masking-language pattern inspection;
- evidence-sufficiency assessment.

The masking check describes a visible combination of gap-minimizing language and weak execution evidence. It does not establish motive, deception, or internal state.

The model returns six dimension scores and evidence. The server, rather than the model, computes `overall_reliability` with versioned fixed weights. All scores are rubric outputs for comparison and review, not probabilities.

### Failure and fallback policy

- `founder-demo` may return a prominently labeled, degraded heuristic fallback when the evaluation agent is unavailable or fails.
- `research-eval` and `ops-reliability` use `strict-no-fallback`; an unavailable or failed agent run is an error, not a heuristic result.
- A completed agent report is marked degraded when the input is lossy or legacy text, a diagnostic tool fails, or the step limit is reached.

This policy prevents a research or operations result from silently changing evaluator class.

### Telemetry and reproducibility fields

Each report records a run ID, a SHA-256 hash of the redacted normalized evaluation input, trace schema/adapter/source versions, prompt/toolset/rubric/weight versions, requested and returned model identifiers, per-model-call status and latency, token fields when returned by the provider, total timing, model/tool call counts, fallback policy/reason, and degradation reason. `token_usage.complete` distinguishes complete usage reporting from missing provider fields.

The model API is called with storage disabled. Telemetry supports audit and later efficiency analysis; the repository does not currently publish comparative cost results.

## Benchmark v1

Benchmark v1 currently contains:

- 16 development cases;
- 8 regression cases;
- 60 repository-visible test candidates;
- AI-proposed annotations kept separate from test inputs and marked `needs_human_review`.

The generated [data-readiness report](evals/v1/reports/data-readiness.md) records passing deterministic checks for schema validity, counts, candidate balance, trace hashes, evidence anchors, group isolation, and exact/near-duplicate leakage. “Scaffold ready” means ready for human annotation; it does not mean a held-out or human-labeled benchmark exists.

The planned study compares four evaluator configurations without presupposing an outcome:

1. the implemented deterministic heuristic baseline;
2. a planned single-pass model judge with no diagnostic tools;
3. a planned fixed full-diagnostic evaluator;
4. the implemented adaptive tool-routing evaluator.

The [evaluation protocol](docs/evaluation-protocol.md) defines fairness controls, split/freeze rules, metrics, statistical reporting, and allowed claims. [Benchmark v1](docs/benchmark-v1.md) separates current candidate readiness from the human gate.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Optional environment variables:

```bash
cp .env.example .env.local
```

- `OPENAI_API_KEY` enables the tool-using evaluation agent.
- `OPENAI_MODEL` overrides the requested model; the default is `gpt-4.1-mini`.

Without an API key, only `founder-demo` can return the degraded heuristic fallback. Research and ops requests fail closed.

## Verification

```bash
npm run typecheck
npm run test
npm run benchmark
npm run build
```

`npm run benchmark` executes a legacy development-only heuristic ranking check. It is not Benchmark v1 test scoring and must not be reported as held-out performance. The main test suite covers trace normalization/pairing/redaction, evaluation input hashing, evaluator orchestration with mocked model responses, fallback policy, deterministic scoring, and Benchmark v1 schema/integrity/metric utilities.

## Safety and limits

- Submitted trace content is encoded and treated as untrusted evidence, not evaluator instructions.
- Public adapters redact recognized secret fields and token patterns by default; this is a safety layer, not a complete data-loss-prevention system.
- Evaluation requests are limited to 25,000 characters, model calls use a 25-second client timeout, and the adaptive loop stops after six diagnostic steps.
- The public API uses a best-effort in-memory rate limit of 10 requests per minute per observed client identifier; it is not a durable distributed quota.
- Generic structured input records provenance supplied by the input. A deployment must control which sources may assert `verified`; the schema does not cryptographically authenticate them.
- Shared reports include report data and a trace excerpt. Do not submit sensitive traces to a public deployment.
- Structural and lexical diagnostics can miss paraphrases and ambiguous dependencies; model synthesis can vary and remains subject to provider/model behavior.

## Research scope

The legacy Public Goods Game (PGG) work is treated here only as exploratory motivation for studying language/behavior gaps and monitoring tradeoffs. Its provenance has not been restored in this repository, so its quantitative headlines are not evidence for AgentEval. See the [research brief](docs/research-brief.md).

## Project structure

- `app/`: Next.js pages and the streaming evaluation API.
- `components/`: trace workbench, agent-run audit trail, and report UI.
- `lib/trace/`: canonical schema, adapters, pairing, redaction, and serialization.
- `lib/agent/`: prompt, diagnostic registry, orchestration, scoring, and telemetry.
- `evals/v1/`: Benchmark v1 candidate data contract, codebook, metrics, integrity utilities, and readiness reports.
- `tests/`: implementation and Benchmark v1 utility tests.
- `docs/`: protocol, trace contract, benchmark status, research brief, product notes, and deployment notes.
