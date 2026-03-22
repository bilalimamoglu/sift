import type { NativeProviderName } from "../types.js";

export interface ProviderModelOption {
  readonly model: string;
  readonly label: string;
  readonly note: string;
  readonly isDefault?: boolean;
}

const OPENAI_MODELS: ProviderModelOption[] = [
  {
    model: "gpt-5-nano",
    label: "gpt-5-nano",
    note: "default, cheapest, fast enough for most fallback passes",
    isDefault: true
  },
  {
    model: "gpt-5.4-nano",
    label: "gpt-5.4-nano",
    note: "newer nano backup, a touch smarter, a touch pricier"
  },
  {
    model: "gpt-5-mini",
    label: "gpt-5-mini",
    note: "smarter fallback, still saner than the expensive stuff"
  }
];

const OPENROUTER_MODELS: ProviderModelOption[] = [
  {
    model: "openrouter/free",
    label: "openrouter/free",
    note: "default, free, a little slower sometimes, still hard to argue with free",
    isDefault: true
  },
  {
    model: "qwen/qwen3-coder:free",
    label: "qwen/qwen3-coder:free",
    note: "free, code-focused, good when you want a named coding fallback"
  },
  {
    model: "deepseek/deepseek-r1:free",
    label: "deepseek/deepseek-r1:free",
    note: "free, stronger reasoning, usually slower"
  }
];

export function getProviderModelOptions(provider: NativeProviderName): ProviderModelOption[] {
  return provider === "openrouter" ? OPENROUTER_MODELS : OPENAI_MODELS;
}

export function getDefaultProviderModel(provider: NativeProviderName): string {
  return getProviderModelOptions(provider).find((option) => option.isDefault)?.model
    ?? getProviderModelOptions(provider)[0]?.model
    ?? "";
}

export function findProviderModelOption(
  provider: NativeProviderName,
  model: string | undefined
): ProviderModelOption | undefined {
  if (!model) {
    return undefined;
  }

  return getProviderModelOptions(provider).find((option) => option.model === model);
}
