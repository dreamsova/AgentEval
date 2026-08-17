import type {
  JsonValue,
  NormalizedTrace,
  TraceDiagnostic
} from "./types";
import { diagnostic, toJsonValue } from "./internal";

export const REDACTED_VALUE = "[REDACTED]";

const secretKeyPattern = /^(?:(?:openai|anthropic|aws|github|slack|stripe)[-_])?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token|token|auth(?:orization)?|cookie|set[-_]?cookie|password|passwd|pwd|secret|client[-_]?secret|private[-_]?key|x[-_]?api[-_]?key|credentials?)$/i;

const textSecretPatterns: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
];

export type SecretRedaction = {
  path: string;
  reason: "secret_field" | "secret_pattern";
};

export type SecretRedactionResult<T> = {
  value: T;
  redactions: SecretRedaction[];
};

function redactString(
  input: string,
  path: string,
  redactions: SecretRedaction[]
): string {
  let output = input;
  for (const pattern of textSecretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(output)) {
      pattern.lastIndex = 0;
      output = output.replace(pattern, REDACTED_VALUE);
      redactions.push({ path, reason: "secret_pattern" });
    }
  }
  return output;
}

function redactValue(
  input: JsonValue,
  path: string,
  redactions: SecretRedaction[]
): JsonValue {
  if (typeof input === "string") {
    return redactString(input, path, redactions);
  }
  if (Array.isArray(input)) {
    return input.map((value, index) =>
      redactValue(value, `${path}[${index}]`, redactions)
    );
  }
  if (input && typeof input === "object") {
    const output: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(input)) {
      const childPath = `${path}.${key}`;
      if (secretKeyPattern.test(key)) {
        output[key] = REDACTED_VALUE;
        redactions.push({ path: childPath, reason: "secret_field" });
      } else {
        output[key] = redactValue(value, childPath, redactions);
      }
    }
    return output;
  }
  return input;
}

export function redactSecrets<T>(input: T): SecretRedactionResult<T> {
  const redactions: SecretRedaction[] = [];
  const jsonValue = toJsonValue(input);
  return {
    value: redactValue(jsonValue, "$", redactions) as T,
    redactions
  };
}

/** Returns a redacted copy and never mutates the caller's trace. */
export function redactTrace(trace: NormalizedTrace): NormalizedTrace {
  const { value: events, redactions } = redactSecrets(trace.events);
  const newDiagnostics: TraceDiagnostic[] = [...trace.diagnostics];
  if (redactions.length) {
    newDiagnostics.push(
      diagnostic(
        "REDACTED_SECRET",
        "info",
        "redaction",
        `${redactions.length} secret value${redactions.length === 1 ? " was" : "s were"} redacted before trace use.`
      )
    );
  }

  return {
    ...trace,
    events,
    diagnostics: newDiagnostics,
    redaction: {
      applied: trace.redaction.applied || redactions.length > 0,
      count: trace.redaction.count + redactions.length
    }
  };
}
