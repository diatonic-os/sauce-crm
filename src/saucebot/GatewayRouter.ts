// Client-side split routing for the hosted-gateway architecture.
//
// The hosted Bifrost gateway (on our VPS) CANNOT reach a client's localhost LM
// Studio/Ollama. So the plugin decides per request:
//   • LOCAL model → send to the client's OWN endpoint (loopback) — data never
//     leaves their machine, and it's the only reachable path anyway.
//   • cloud / non-local model → send through the hosted gateway.
//
// This is "loop LM Studio/Ollama requests back to the client's own system" done
// where it's physically possible — on the client, not the server.

export interface RouteInput {
  /** The target model id. */
  model: string;
  /** Models available on the client's own LM Studio/Ollama (auto-detected). */
  localModels: string[];
  /** The client's own local endpoint (loopback/LAN), if detected. */
  localEndpoint?: string;
  /** The hosted Bifrost gateway endpoint, if configured. */
  gatewayUrl?: string;
}

export interface RouteDecision {
  target: "local" | "gateway" | "none";
  baseUrl: string;
  reason: string;
}

/**
 * Decide where a request goes. Priority:
 *   1. A LOCAL model with a reachable local endpoint → stay local (privacy +
 *      the gateway can't reach it).
 *   2. Otherwise the hosted gateway (cloud + any local fleet IT can reach).
 *   3. No gateway but a local endpoint → local fallback.
 *   4. Nothing reachable → none.
 */
/** Local-provider config slice needed to decide routing (from localLLM settings). */
export interface LocalRouteConfig {
  endpoint: string;
  model: string;
}

/**
 * Adapt plugin settings into a {@link RouteInput} and decide the route for the
 * currently-selected `model`. The "local fleet" is the set of models the user
 * has configured on their own LM Studio / Ollama endpoints; if the active model
 * is one of those AND a local endpoint exists, it stays on loopback even when a
 * gateway is connected (the gateway cannot reach the client's localhost).
 */
export function resolveSauceRoute(args: {
  model: string;
  gatewayUrl?: string;
  local: { lmstudio?: LocalRouteConfig; ollama?: LocalRouteConfig };
}): RouteDecision {
  const localModels: string[] = [];
  let localEndpoint: string | undefined;
  for (const cfg of [args.local.lmstudio, args.local.ollama]) {
    if (cfg?.model) {
      localModels.push(cfg.model);
      if (!localEndpoint && cfg.endpoint) localEndpoint = cfg.endpoint;
    }
  }
  return decideRoute({
    model: args.model,
    localModels,
    ...(localEndpoint !== undefined ? { localEndpoint } : {}),
    ...(args.gatewayUrl ? { gatewayUrl: args.gatewayUrl } : {}),
  });
}

export function decideRoute(input: RouteInput): RouteDecision {
  const isLocalModel = input.localModels.includes(input.model);

  if (isLocalModel && input.localEndpoint) {
    return {
      target: "local",
      baseUrl: input.localEndpoint,
      reason: "local model → client's own system (loopback)",
    };
  }
  if (input.gatewayUrl) {
    return {
      target: "gateway",
      baseUrl: input.gatewayUrl,
      reason: "routed via hosted gateway",
    };
  }
  if (input.localEndpoint) {
    return {
      target: "local",
      baseUrl: input.localEndpoint,
      reason: "no gateway configured → local fallback",
    };
  }
  return { target: "none", baseUrl: "", reason: "no route available" };
}
