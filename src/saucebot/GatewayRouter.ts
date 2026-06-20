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
