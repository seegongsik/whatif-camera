export type EnvMap = Record<string, string | undefined>;

export function resolveBasetenApiKey(env: EnvMap = process.env): string | undefined {
  const key = env.BASETEN_API_KEY;
  return key && key.length > 0 ? key : undefined;
}

/** Official name first, then the alias. Not used for calls yet (SAM 3.1 waits for the hackathon credits). */
export function resolveModelApiKey(env: EnvMap = process.env): string | undefined {
  const key = env.MODEL_API_KEY ?? env.META_API_KEY;
  return key && key.length > 0 ? key : undefined;
}

export function keyPresence(env: EnvMap = process.env): {
  basetenApiKeyConfigured: boolean;
  modelApiKeyConfigured: boolean;
} {
  return {
    basetenApiKeyConfigured: resolveBasetenApiKey(env) !== undefined,
    modelApiKeyConfigured: resolveModelApiKey(env) !== undefined,
  };
}
