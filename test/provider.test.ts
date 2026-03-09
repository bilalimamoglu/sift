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
      responseMode: "text"
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
        responseMode: "text"
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
        responseMode: "text"
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
      responseMode: "text"
    });

    expect(result.text).toBe("All tests passed.");
  });
});
