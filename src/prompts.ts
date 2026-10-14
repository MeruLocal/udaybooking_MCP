import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { INTERNATIONAL, MARKET_CODES } from "./constants.js";

/**
 * Prompts: ready-made call sequences for the two most common buyer questions,
 * built only from tools that exist (a test checks every tool name used here).
 *
 * The text holds no prices, plan names or customer data: the model is told to
 * quote what the tools return, never to restate figures from memory.
 */

const MARKETS = [...MARKET_CODES, INTERNATIONAL] as [string, ...string[]];

const MarketArg = z
  .enum(MARKETS)
  .optional()
  .describe(`Market edition: ${MARKETS.join(", ")} (default: ${INTERNATIONAL}).`);

export function comparePlansText(market: string): string {
  return [
    `Compare Udaybooking's plans for the '${market}' market.`,
    "",
    "1. Call udaybooking_get_pricing with " +
      `{"market": "${market}", "include_page_text": true}.`,
    `2. Call udaybooking_get_faqs with {"source": "pricing", "market": "${market}"}.`,
    "3. Present a table of the plans the pricing tool returns. Quote prices, currencies and " +
      "limits only as returned; for a plan with no machine-readable price, say what the page " +
      "prose says about it (for example that it is quoted).",
    "4. Cite the source_url.",
    "5. Do not estimate, convert or round prices, and do not add plans the tools did not return.",
  ].join("\n");
}

export function fitText(business: string, needs: string | undefined, market: string): string {
  return [
    `Decide whether Udaybooking is right for this business: ${business}.`,
    needs ? `Their needs: ${needs}.` : "Their needs were not stated; infer them from the business.",
    `Market: '${market}'.`,
    "",
    "1. Call udaybooking_get_site_summary to orient yourself.",
    `2. Call udaybooking_search_content (market '${market}') for each need, for example team ` +
      "scheduling, reminders, payments or integrations.",
    "3. Read the top one or two pages with udaybooking_get_page.",
    "4. Call udaybooking_get_automation_capabilities to check the limits.",
    "5. Answer: fit, partial fit or not a fit. Cite the pages you used and list anything you " +
      "could not confirm.",
    `6. End with next steps from udaybooking_get_started (market '${market}').`,
  ].join("\n");
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "compare_plans",
    {
      title: "Compare Udaybooking plans",
      description: "Compare Udaybooking's plans and prices for a market, quoting only the published data.",
      argsSchema: { market: MarketArg },
    },
    ({ market }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: comparePlansText(market ?? INTERNATIONAL) },
        },
      ],
    }),
  );

  server.registerPrompt(
    "is_udaybooking_right_for_me",
    {
      title: "Is Udaybooking right for me?",
      description: "Check whether Udaybooking fits a business and its needs, with cited pages.",
      argsSchema: {
        business: z
          .string()
          .min(2)
          .max(300)
          .describe("The business, in a few words, e.g. '2-chair dental clinic'."),
        needs: z
          .string()
          .max(500)
          .optional()
          .describe("What they need, e.g. 'team scheduling, WhatsApp reminders'."),
        market: MarketArg,
      },
    },
    ({ business, needs, market }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: fitText(business, needs, market ?? INTERNATIONAL) },
        },
      ],
    }),
  );
}
