export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("No stdin detected. Pipe command output into sift.");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString("utf8");
}
