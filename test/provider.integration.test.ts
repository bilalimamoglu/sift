import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "../src/providers/openai.js";
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

  it("throws actionable errors on non-200 responses", async () => {
    server = await createFakeOpenAIServer(() => ({
      status: 500,
      body: {
        error: {
          message: "upstream exploded"
        }
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
    ).rejects.toThrow("HTTP 500: upstream exploded");
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

  it("keeps OpenRouter in auto mode without native response_format", async () => {
    let requestPath = "";
    server = await createFakeOpenAIServer((_body, _index, request) => {
      requestPath = request.path;
      return {
        body: {
          choices: [{ message: { content: "{\"status\":\"ok\"}" } }]
        }
      };
    });

    const provider = new OpenAICompatibleProvider({
      baseUrl: `${server.baseUrl}/v1`,
      apiKey: "test-key",
      name: "openrouter"
    });

    await provider.generate({
      model: "openrouter/free",
      prompt: "hello",
      temperature: 0.1,
      maxOutputTokens: 50,
      timeoutMs: 1000,
      responseMode: "json",
      jsonResponseFormat: "auto"
    });

    expect(provider.name).toBe("openrouter");
    expect(requestPath).toBe("/v1/chat/completions");
    expect(server.requests[0].response_format).toBeUndefined();
  });

  it("lets OpenRouter opt into native response_format explicitly", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [{ message: { content: "{\"status\":\"ok\"}" } }]
      }
    }));

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key",
      name: "openrouter"
    });

    await provider.generate({
      model: "openrouter/free",
      prompt: "hello",
      temperature: 0.1,
      maxOutputTokens: 50,
      timeoutMs: 1000,
      responseMode: "json",
      jsonResponseFormat: "on"
    });

    expect(provider.name).toBe("openrouter");
    expect(server.requests[0].response_format).toEqual({ type: "json_object" });
  });

  it("does not use native JSON response_format when turned off", async () => {
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
      jsonResponseFormat: "off"
    });

    expect(server.requests[0].response_format).toBeUndefined();
  });

  it("uses native JSON response_format when explicitly enabled", async () => {
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
      jsonResponseFormat: "on"
    });

    expect(server.requests[0].response_format).toEqual({ type: "json_object" });
  });

  it("parses array-based message content and rejects empty responses", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content: [
                { text: "All " },
                { text: "tests passed." }
              ]
            }
          }
        ]
      }
    }));

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key"
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
    ).resolves.toMatchObject({ text: "All tests passed." });

    await server.close();
    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [{ message: { content: [] } }]
      }
    }));

    const emptyProvider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key"
    });

    await expect(
      emptyProvider.generate({
        model: "test-model",
        prompt: "hello",
        temperature: 0.1,
        maxOutputTokens: 50,
        timeoutMs: 1000,
        responseMode: "text",
        jsonResponseFormat: "auto"
      })
    ).rejects.toThrow("empty response");
  });

  it("rejects non-string and non-array content as empty", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [{ message: { content: { text: "ignored" } } }]
      }
    }));

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key"
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
    ).rejects.toThrow("empty response");
  });

  it("ignores non-text array items in compatible message content", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        choices: [
          {
            message: {
              content: [
                { type: "input_text" },
                { text: "usable text" }
              ]
            }
          }
        ]
      }
    }));

    const provider = new OpenAICompatibleProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key"
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
    ).resolves.toMatchObject({ text: "usable text" });
  });

  it("keeps generic HTTP errors when the error body is not JSON", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("bad gateway", {
        status: 502,
        headers: {
          "content-type": "text/plain"
        }
      })) as typeof fetch;

    try {
      const provider = new OpenAICompatibleProvider({
        baseUrl: "https://example.test/v1"
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
      ).rejects.toThrow("Provider returned HTTP 502");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rethrows non-timeout fetch errors for compatible providers", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("socket hang up");
    }) as typeof fetch;

    try {
      const provider = new OpenAICompatibleProvider({
        baseUrl: "https://example.test/v1"
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
      ).rejects.toThrow("socket hang up");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("OpenAIProvider", () => {
  it("parses a successful responses API payload and usage", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "All tests passed."
              }
            ]
          }
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15
        }
      }
    }));

    const provider = new OpenAIProvider({
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
    expect(server.requests[0].max_output_tokens).toBe(50);
    expect(server.requests[0].input).toBe("hello");
    expect(server.requests[0].temperature).toBeUndefined();
    expect(server.requests[0].reasoning).toEqual({ effort: "minimal" });
    expect(server.requests[0].text).toEqual({ verbosity: "low" });
  });

  it("throws actionable errors on non-200 responses", async () => {
    server = await createFakeOpenAIServer(() => ({
      status: 400,
      body: {
        error: {
          message: "Unsupported parameter: max_tokens"
        }
      }
    }));

    const provider = new OpenAIProvider({
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
    ).rejects.toThrow("HTTP 400: Unsupported parameter: max_tokens");
  });

  it("uses native JSON shaping in auto mode", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "{\"status\":\"ok\"}"
              }
            ]
          }
        ]
      }
    }));

    const provider = new OpenAIProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key"
    });

    await provider.generate({
      model: "test-model",
      prompt: "Return valid JSON with status ok.",
      temperature: 0.1,
      maxOutputTokens: 50,
      timeoutMs: 1000,
      responseMode: "json",
      jsonResponseFormat: "auto"
    });

    expect(server.requests[0].reasoning).toEqual({ effort: "minimal" });
    expect(server.requests[0].text).toEqual({
      verbosity: "low",
      format: {
        type: "json_object"
      }
    });
  });

  it("does not use native JSON shaping when turned off", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "{\"status\":\"ok\"}"
              }
            ]
          }
        ]
      }
    }));

    const provider = new OpenAIProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key"
    });

    await provider.generate({
      model: "test-model",
      prompt: "Return valid JSON with status ok.",
      temperature: 0.1,
      maxOutputTokens: 50,
      timeoutMs: 1000,
      responseMode: "json",
      jsonResponseFormat: "off"
    });

    expect(server.requests[0].reasoning).toEqual({ effort: "minimal" });
    expect(server.requests[0].text).toEqual({ verbosity: "low" });
  });

  it("throws when the responses payload has no text output", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        output: []
      }
    }));

    const provider = new OpenAIProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key"
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
    ).rejects.toThrow("empty response");
  });

  it("rejects responses payloads without an output array", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        output: { type: "message" }
      }
    }));

    const provider = new OpenAIProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key"
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
    ).rejects.toThrow("empty response");
  });

  it("supports output_text shortcuts and generic HTTP errors", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        output_text: "All tests passed."
      }
    }));

    const provider = new OpenAIProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key"
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
    ).resolves.toMatchObject({ text: "All tests passed." });

    await server.close();
    server = undefined;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("bad request", {
        status: 400,
        headers: {
          "content-type": "text/plain"
        }
      })) as typeof fetch;

    try {
      const failingProvider = new OpenAIProvider({
        baseUrl: "https://api.openai.com/v1"
      });

      await expect(
        failingProvider.generate({
          model: "test-model",
          prompt: "hello",
          temperature: 0.1,
          maxOutputTokens: 50,
          timeoutMs: 1000,
          responseMode: "text",
          jsonResponseFormat: "auto"
        })
      ).rejects.toThrow("Provider returned HTTP 400");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("ignores non-output_text items in responses content", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        output: [
          {
            type: "message",
            content: [
              {
                type: "tool_call",
                text: "ignored"
              },
              {
                type: "output_text",
                text: "All tests passed."
              }
            ]
          }
        ]
      }
    }));

    const provider = new OpenAIProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key"
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
    ).resolves.toMatchObject({ text: "All tests passed." });
  });

  it("ignores output items without content arrays and rethrows non-timeout fetch errors", async () => {
    server = await createFakeOpenAIServer(() => ({
      body: {
        output: [
          {
            type: "message"
          },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "All tests passed."
              }
            ]
          }
        ]
      }
    }));

    const provider = new OpenAIProvider({
      baseUrl: server.baseUrl,
      apiKey: "test-key"
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
    ).resolves.toMatchObject({ text: "All tests passed." });

    await server.close();
    server = undefined;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      const failingProvider = new OpenAIProvider({
        baseUrl: "https://api.openai.com/v1"
      });

      await expect(
        failingProvider.generate({
          model: "test-model",
          prompt: "hello",
          temperature: 0.1,
          maxOutputTokens: 50,
          timeoutMs: 1000,
          responseMode: "text",
          jsonResponseFormat: "auto"
        })
      ).rejects.toThrow("network down");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("times out slow responses API requests", async () => {
    server = await createFakeOpenAIServer(() => ({
      delayMs: 200,
      body: {
        output_text: "late"
      }
    }));

    const provider = new OpenAIProvider({
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
});
