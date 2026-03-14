import { defaultConfig } from "./defaults.js";
import type {
  NativeProviderName,
  ProviderConfig,
  ProviderProfile,
  ProviderProfiles,
  SiftConfig
} from "../types.js";

export function getNativeProviderDefaults(
  provider: NativeProviderName
): Pick<ProviderConfig, "provider" | "model" | "baseUrl"> {
  if (provider === "openrouter") {
    return {
      provider,
      model: "openrouter/free",
      baseUrl: "https://openrouter.ai/api/v1"
    };
  }

  return {
    provider,
    model: defaultConfig.provider.model,
    baseUrl: defaultConfig.provider.baseUrl
  };
}

export function getProfileProviderState(
  provider: NativeProviderName,
  profile?: ProviderProfile
): Pick<ProviderConfig, "provider" | "model" | "baseUrl"> {
  const defaults = getNativeProviderDefaults(provider);

  return {
    provider,
    model: profile?.model ?? defaults.model,
    baseUrl: profile?.baseUrl ?? defaults.baseUrl
  };
}

export function getStoredProviderProfile(
  config: SiftConfig,
  provider: NativeProviderName
): ProviderProfile | undefined {
  const existingProfile = config.providerProfiles?.[provider];
  if (existingProfile) {
    return existingProfile;
  }

  if (config.provider.provider !== provider) {
    return undefined;
  }

  return {
    model: config.provider.model,
    baseUrl: config.provider.baseUrl,
    apiKey: config.provider.apiKey || undefined
  };
}

export function setStoredProviderProfile(
  config: SiftConfig,
  provider: NativeProviderName,
  profile: ProviderProfile
): SiftConfig {
  const providerProfiles: ProviderProfiles = {
    ...(config.providerProfiles ?? {}),
    [provider]: profile
  };

  return {
    ...config,
    providerProfiles
  };
}

export function preserveActiveNativeProviderProfile(config: SiftConfig): SiftConfig {
  const provider = config.provider.provider;
  if (provider !== "openai" && provider !== "openrouter") {
    return config;
  }

  if (config.providerProfiles?.[provider]) {
    return config;
  }

  return setStoredProviderProfile(config, provider, {
    model: config.provider.model,
    baseUrl: config.provider.baseUrl,
    apiKey: config.provider.apiKey || undefined
  });
}

export function applyActiveProvider(
  config: SiftConfig,
  provider: NativeProviderName,
  profile: ProviderProfile | undefined,
  apiKey: string
): SiftConfig {
  return {
    ...config,
    provider: {
      ...config.provider,
      ...getProfileProviderState(provider, profile),
      apiKey
    }
  };
}
