import http from "node:http";

export interface FakeOpenAIResponse {
  status?: number;
  body?: unknown;
  delayMs?: number;
}

export interface FakeOpenAIRequest {
  path: string;
}

export interface FakeOpenAIServer {
  baseUrl: string;
  requests: any[];
  close(): Promise<void>;
}

export async function createFakeOpenAIServer(
  responder: (
    body: any,
    index: number,
    request: FakeOpenAIRequest
  ) => FakeOpenAIResponse | Promise<FakeOpenAIResponse>
): Promise<FakeOpenAIServer> {
  const requests: any[] = [];

  const server = http.createServer(async (request, response) => {
    const requestPath = request.url?.split("?")[0];

    if (
      request.method !== "POST" ||
      (requestPath !== "/chat/completions" &&
        requestPath !== "/v1/chat/completions" &&
        requestPath !== "/responses" &&
        requestPath !== "/v1/responses")
    ) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }

    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push(body);

    const result = await responder(body, requests.length - 1, {
      path: requestPath ?? ""
    });
    if (result.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, result.delayMs));
    }

    response.statusCode = result.status ?? 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(result.body ?? {}));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve fake server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}
