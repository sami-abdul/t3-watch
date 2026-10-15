/**
 * `t3-watch mcp`: MCP over stdio for agents. It forwards every message to the running service's
 * /mcp endpoint with the token from Watch's own config, so agent configs never hold the token.
 */
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { loadConfig } from "./config.ts";

export const relay = async () => {
  const config = loadConfig();
  const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
  const upstream = new StreamableHTTPClientTransport(new URL(`http://${host}:${config.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${config.token}` } },
  });
  const local = new StdioServerTransport();
  local.onmessage = (message) => {
    upstream.send(message).catch((error: unknown) => {
      // Answer requests even when Watch is down, so the agent sees why instead of hanging.
      if ("id" in message && message.id !== undefined && "method" in message)
        void local.send({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32000,
            message: `t3-watch is not reachable on port ${config.port}. Start it with t3-watch start or t3-watch install. (${error instanceof Error ? error.message : String(error)})`,
          },
        });
    });
  };
  upstream.onmessage = (message) => void local.send(message);
  upstream.onerror = (error) => console.error("t3-watch relay:", error.message);
  local.onclose = () => {
    void upstream.close();
    process.exit(0);
  };
  await upstream.start();
  await local.start();
};
