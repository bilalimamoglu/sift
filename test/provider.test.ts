import { afterEach, describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "../src/providers/openaiCompatible.js";
import { createFakeOpenAIServer, type FakeOpenAIServer } from "./helpers/fake-openai.js";

let server: FakeOpenAIServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("OpenAICompatibleProvider", () => {
  it("parses a successful response and usage", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [{ message: { content: "All tests passed." } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15
        }
      }
    }));

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key"
    });
    const result = await provider.generate({
      model: "test-model",
      prompt: "hello",
      temperature: 0.1,
      maxOutputTokens: 50,
      timeoutMs: 1000,
      responseMode: "text",
      jsonResponseFormat: "auto"
    });

    expect(result.text).toBe("All tests passed.");
    expect(result.usage?.totalTokens).toBe(15);
    expect(server.requests[0].model).toBe("test-model");
  });

  it("throws on non-200 responses", async () => {
    server = await createFakeOpenAIServer(() => ({
      status: 500,
      body: {
        error: "boom"
      }
    }));

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl
    });

    await expect(
      provider.generate({
        model: "test-model",
        prompt: "hello",
        temperature: 0.1,
        maxOutputTokens: 50,
        timeoutMs: 1000,
        responseMode: "text",
        jsonResponseFormat: "auto"
      })
    ).rejects.toThrow("HTTP 500");
  });

  it("times out slow requests", async () => {
    server = await createFakeOpenAIServer(() => ({
      delayMs: 200,
      body: {
        choices: [{ message: { content: "late" } }]
      }
    }));

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl
    });

    await expect(
      provider.generate({
        model: "test-model",
        prompt: "hello",
        temperature: 0.1,
        maxOutputTokens: 50,
        timeoutMs: 20,
        responseMode: "text",
        jsonResponseFormat: "auto"
      })
    ).rejects.toThrow("timed out");
  });

  it("preserves a /v1 base path for OpenAI-style URLs", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [{ message: { content: "All tests passed." } }]
      }
    }));

    const provider = new OpenAICompatibleProvider({
      baseUrl: `${server.baseUrl}/v1`
    });

    const result = await provider.generate({
      model: "test-model",
      prompt: "hello",
      temperature: 0.1,
      maxOutputTokens: 50,
      timeoutMs: 1000,
      responseMode: "text",
      jsonResponseFormat: "auto"
    });

    expect(result.text).toBe("All tests passed.");
  });

  it("uses native JSON response_format for the default OpenAI endpoint in auto mode", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: any;

    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{\"status\":\"ok\"}" } }]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    try {
      const provider = new OpenAICompatibleProvider({
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key"
      });

      await provider.generate({
        model: "test-model",
        prompt: "hello",
        temperature: 0.1,
        maxOutputTokens: 50,
        timeoutMs: 1000,
        responseMode: "json",
        jsonResponseFormat: "auto"
      });

      expect(requestBody.response_format).toEqual({ type: "json_object" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not use native JSON response_format for non-OpenAI endpoints in auto mode", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [{ message: { content: "{\"status\":\"ok\"}" } }]
      }
    }));

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key"
    });

    await provider.generate({
      model: "test-model",
      prompt: "hello",
      temperature: 0.1,
      maxOutputTokens: 50,
      timeoutMs: 1000,
      responseMode: "json",
      jsonResponseFormat: "auto"
    });

    expect(server.requests[0].response_format).toBeUndefined();
  });
});
