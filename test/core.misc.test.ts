import { PassThrough, Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { buildFallbackOutput } from "../src/core/fallback.js";
import { prepareInput } from "../src/core/pipeline.js";
import { isRetriableReason, looksLikeRejectedModelOutput } from "../src/core/quality.js";
import { readStdin } from "../src/core/stdin.js";
import { getGenericFormatPolicy } from "../src/prompts/formats.js";
import { isPromptPolicyName } from "../src/prompts/policies.js";
import { createProvider } from "../src/providers/factory.js";
import { createPresentation } from "../src/ui/presentation.js";
import { defaultConfig } from "../src/config/defaults.js";

describe("misc core and UI helpers", () => {
  it("buildFallbackOutput handles text, json, and verdict outputs", () => {
    expect(
      buildFallbackOutput({
        format: "brief",
        reason: "boom",
        rawInput: "x".repeat(1300),
        rawFallback: false
      })
    ).toBe(
      "Sift fallback triggered (boom). Raw may still be needed because provider follow-up failed."
    );

    expect(JSON.parse(buildFallbackOutput({
      format: "json",
      reason: "boom",
      rawInput: "",
      rawFallback: true
    })).status).toBe("error");

    const verdict = JSON.parse(
      buildFallbackOutput({
        format: "verdict",
        reason: "boom",
        rawInput: "",
        rawFallback: true
      })
    );
    expect(verdict.verdict).toBe("unclear");
    expect(verdict.reason).toContain("Sift fallback");
  });

  it("prepareInput reports redaction and truncation metadata", () => {
    const prepared = prepareInput("token sk-1234567890", {
      ...defaultConfig.input,
      redact: true,
      maxInputChars: 10,
      headChars: 4,
      tailChars: 4
    });

    expect(prepared.meta.redactionApplied).toBe(true);
    expect(prepared.meta.truncatedApplied).toBe(true);
    expect(prepared.meta.originalLength).toBe("token sk-1234567890".length);
  });

  it("quality helpers cover retriable and rejection branches", () => {
    expect(isRetriableReason("HTTP 500")).toBe(true);
    expect(isRetriableReason("network timeout")).toBe(true);
    expect(isRetriableReason("bad request")).toBe(false);

    expect(
      looksLikeRejectedModelOutput({
        source: "short",
        candidate: "",
        responseMode: "text"
      })
    ).toBe(true);
    expect(
      looksLikeRejectedModelOutput({
        source: "short",
        candidate: "```json\n{}\n```",
        responseMode: "json"
      })
    ).toBe(true);
    expect(
      looksLikeRejectedModelOutput({
        source: "short",
        candidate: "not json",
        responseMode: "json"
      })
    ).toBe(true);
    expect(
      looksLikeRejectedModelOutput({
        source: "x".repeat(1000),
        candidate: "y".repeat(900),
        responseMode: "text"
      })
    ).toBe(true);
    expect(
      looksLikeRejectedModelOutput({
        source: "short",
        candidate: "useful answer",
        responseMode: "text"
      })
    ).toBe(false);
    expect(
      looksLikeRejectedModelOutput({
        source: "short",
        candidate: "Insufficient signal in the provided input.",
        responseMode: "text"
      })
    ).toBe(false);
    expect(
      looksLikeRejectedModelOutput({
        source: "short",
        candidate: "x".repeat(200),
        responseMode: "text"
      })
    ).toBe(true);
  });

  it("readStdin rejects tty stdin and reads piped input", async () => {
    const originalStdin = process.stdin;
    const ttyStream = new PassThrough() as unknown as typeof process.stdin;
    Object.defineProperty(ttyStream, "isTTY", { value: true });
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: ttyStream
    });

    await expect(readStdin()).rejects.toThrow("No stdin detected");

    const piped = new PassThrough() as unknown as typeof process.stdin;
    Object.defineProperty(piped, "isTTY", { value: false });
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: piped
    });
    piped.end("hello");

    await expect(readStdin()).resolves.toBe("hello");

    const stringStream = Readable.from(["world"]) as unknown as typeof process.stdin;
    Object.defineProperty(stringStream, "isTTY", { value: false });
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: stringStream
    });

    await expect(readStdin()).resolves.toBe("world");

    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: originalStdin
    });
  });

  it("generic format policies cover all formats", () => {
    expect(getGenericFormatPolicy("brief").responseMode).toBe("text");
    expect(getGenericFormatPolicy("bullets").responseMode).toBe("text");
    expect(getGenericFormatPolicy("verdict").outputContract).toContain('"verdict"');
    expect(getGenericFormatPolicy("json", '{"a":1}').outputContract).toBe('{"a":1}');
    expect(getGenericFormatPolicy("json").outputContract).toContain('"answer"');
  });

  it("provider factory selects the right provider and rejects unknown providers", () => {
    expect(createProvider(defaultConfig).name).toBe("openai");
    expect(
      createProvider({
        ...defaultConfig,
        provider: {
          ...defaultConfig.provider,
          provider: "openai-compatible"
        }
      }).name
    ).toBe("openai-compatible");

    expect(() =>
      createProvider({
        ...defaultConfig,
        provider: {
          ...defaultConfig.provider,
          provider: "mystery" as never
        }
      })
    ).toThrow("Unsupported provider: mystery");
  });

  it("presentation helpers return colored and plain output", () => {
    const plain = createPresentation(false);
    const color = createPresentation(true);

    expect(plain.banner("0.3.1")).toContain("Trim the noise. Keep the signal.");
    expect(plain.welcome("hello")).toBe("Welcome to sift. hello");
    expect(plain.success("ok")).toBe("ok");
    expect(plain.warning("careful")).toBe("careful");
    expect(plain.info("note")).toBe("note");
    expect(plain.error("boom")).toBe("boom");
    expect(plain.labelValue("provider", "openai")).toBe("provider: openai");
    expect(plain.command("sift doctor")).toBe("sift doctor");

    expect(color.success("ok")).toContain("✓");
    expect(color.warning("careful")).toContain("!");
    expect(color.info("note")).toContain("•");
    expect(color.command("sift doctor")).toContain("sift doctor");
  });

  it("recognizes built-in policy names", () => {
    expect(isPromptPolicyName("test-status")).toBe(true);
    expect(isPromptPolicyName("not-a-policy")).toBe(false);
  });
});
