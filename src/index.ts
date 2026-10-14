#!/usr/bin/env node
/**
 * Entry point: udaybooking-mcp-server over stdio.
 *
 * stdio is the transport Claude Desktop and Claude Code use for local servers.
 * The critical constraint it imposes is that **stdout belongs to the MCP
 * protocol**: every log line in this process goes to stderr (see utils/logger),
 * and nothing here ever calls console.log.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const { server, logger } = buildServer();
  const transport = new StdioServerTransport();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("shutting down", { signal });
    try {
      await server.close();
    } catch (error) {
      logger.warn("error during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // A crash must not leave a half-dead server attached to the client's stdio.
  process.on("uncaughtException", (error: Error) => {
    logger.error("uncaught exception", { error: error.message, stack: error.stack });
    process.exit(1);
  });
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error("unhandled rejection", {
      error: reason instanceof Error ? reason.message : String(reason),
    });
    process.exit(1);
  });

  await server.connect(transport);
  logger.info("udaybooking-mcp-server listening on stdio");
}

main().catch((error: unknown) => {
  // Startup failures (bad configuration, mostly) must be visible, and must go
  // to stderr so they cannot corrupt the protocol stream.
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      logger: "udaybooking-mcp-server",
      msg: "fatal startup error",
      ctx: { error: error instanceof Error ? error.message : String(error) },
    })}\n`,
  );
  process.exit(1);
});
