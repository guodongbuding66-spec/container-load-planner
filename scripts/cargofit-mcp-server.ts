#!/usr/bin/env node
/**
 * CargoFit MCP Stdio Server (JSON-RPC 2.0, Direction 22).
 * Exposes CargoFit's deterministic 3D container load planning engine over stdin/stdout
 * for AI agents, ERP/WMS connectors, and local CLI automation.
 *
 * Usage:
 *   node --experimental-transform-types scripts/cargofit-mcp-server.mjs
 */
import readline from "node:readline";
import {
  API_SCHEMA_VERSION,
  CARGOFIT_MCP_TOOL_DESCRIPTOR,
  executeCargoFitApiV1,
} from "../lib/packing/api-contract.ts";
import { ENGINE_VERSION } from "../lib/packing/engine.ts";

const SERVER_INFO = {
  name: "cargofit-mcp-server",
  version: ENGINE_VERSION,
  protocolVersion: "2024-11-05",
};

function send(msg: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function handleRequest(req: { id?: string | number | null; method?: string; params?: Record<string, unknown> }) {
  const { id, method, params } = req ?? {};
  if (method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: SERVER_INFO.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version },
      },
    });
  }
  if (method === "notifications/initialized") {
    return;
  }
  if (method === "tools/list") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: CARGOFIT_MCP_TOOL_DESCRIPTOR.name,
            description: CARGOFIT_MCP_TOOL_DESCRIPTOR.description,
            inputSchema: CARGOFIT_MCP_TOOL_DESCRIPTOR.inputSchema,
          },
        ],
      },
    });
  }
  if (method === "tools/call") {
    const toolName = params?.name;
    if (toolName !== CARGOFIT_MCP_TOOL_DESCRIPTOR.name) {
      return send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${String(toolName)}` },
      });
    }
    const args = (params?.arguments ?? {}) as Record<string, unknown>;
    const payload = {
      schema: (args.schema as typeof API_SCHEMA_VERSION) ?? API_SCHEMA_VERSION,
      requestId: typeof args.requestId === 'string' ? args.requestId : (id != null ? String(id) : undefined),
      computeMode: args.computeMode as 'fast' | 'standard' | 'deep' | 'extreme' | undefined,
      customBudgetMs: typeof args.customBudgetMs === 'number' ? args.customBudgetMs : undefined,
      seed: typeof args.seed === 'number' ? args.seed : undefined,
      includeEngineeringAudit: Boolean(args.includeEngineeringAudit),
      request: args.request as Parameters<typeof executeCargoFitApiV1>[0]['request'],
    };
    const response = executeCargoFitApiV1(payload);
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(response) }],
        isError: !response.ok,
      },
    });
  }
  if (id !== undefined) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${String(method)}` },
    });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    handleRequest(JSON.parse(trimmed));
  } catch (err) {
    send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: err instanceof Error ? err.message : "Parse error" },
    });
  }
});
