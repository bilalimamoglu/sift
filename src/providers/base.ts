import type { GenerateInput, GenerateResult } from "../types.js";

export interface LLMProvider {
  readonly name: string;
  generate(input: GenerateInput): Promise<GenerateResult>;
}
