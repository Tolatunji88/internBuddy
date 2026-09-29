#!/usr/bin/env node
import '../core/quiet.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openContext } from '../core/context.js';
import { createServer } from './server.js';

// stdout is the MCP protocol channel. Nothing reachable from here may console.log;
// diagnostics go to stderr.
async function main(): Promise<void> {
  const ctx = openContext();
  const server = createServer(ctx);
  const shutdown = () => {
    try {
      ctx.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  console.error(`internbuddy-mcp failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
