export interface RedactOptions {
  strict: boolean;
}

const BASE_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer ***"],
  [/\bsk-[A-Za-z0-9_-]+\b/g, "sk-***"],
  [/\b(api[_-]?key)\s*[:=]\s*([^\s]+)/gi, "$1=***"],
  [/\b(token)\s*[:=]\s*([^\s]+)/gi, "$1=***"],
  [/\b(password|passwd|pwd)\s*[:=]\s*([^\s]+)/gi, "$1=***"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "***@***"],
  [/\beyJ[A-Za-z0-9._-]+\b/g, "***JWT***"]
];

const STRICT_PATTERNS: Array<[RegExp, string]> = [
  [/([?&](?:token|key|api_key|access_token)=)[^&\s]+/gi, "$1***"],
  [/\b[0-9a-f]{32,}\b/gi, "***HEX***"]
];

export function redactInput(input: string, options: RedactOptions): string {
  let output = input;

  for (const [pattern, replacement] of BASE_PATTERNS) {
    output = output.replace(pattern, replacement);
  }

  if (options.strict) {
    for (const [pattern, replacement] of STRICT_PATTERNS) {
      output = output.replace(pattern, replacement);
    }
  }

  return output;
}
