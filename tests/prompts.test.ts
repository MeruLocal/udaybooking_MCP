import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { TOOL_NAMES } from "../src/tool-catalog.js";

let client: Client;

beforeEach(async () => {
  const { server } = buildServer({ logLevel: "silent" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([client.connect(a), server.connect(b)]);
});

afterEach(async () => {
  await client.close();
});

const textOf = (r: { messages: { content: { type: string; text?: string } }[] }): string =>
  r.messages.map((m) => m.content.text ?? "").join("\n");

describe("prompts", () => {
  it("lists both prompts with descriptions and arguments", async () => {
    const { prompts } = await client.listPrompts();
    const byName = Object.fromEntries(prompts.map((p) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(["compare_plans", "is_udaybooking_right_for_me"]);
    expect(byName.compare_plans?.description).toBeTruthy();
    expect(byName.compare_plans?.arguments?.map((a) => a.name)).toEqual(["market"]);
    const fit = byName.is_udaybooking_right_for_me?.arguments ?? [];
    expect(fit.find((a) => a.name === "business")?.required).toBe(true);
    expect(fit.find((a) => a.name === "needs")?.required).toBeFalsy();
  });

  it("interpolates the arguments", async () => {
    const plans = textOf(await client.getPrompt({ name: "compare_plans", arguments: { market: "in" } }));
    expect(plans).toContain(`"market": "in"`);
    const fit = textOf(
      await client.getPrompt({
        name: "is_udaybooking_right_for_me",
        arguments: { business: "2-chair dental clinic", needs: "SMS reminders", market: "gb" },
      }),
    );
    expect(fit).toContain("2-chair dental clinic");
    expect(fit).toContain("SMS reminders");
    expect(fit).toContain("'gb'");
  });

  it("defaults the market to international", async () => {
    const plans = textOf(await client.getPrompt({ name: "compare_plans", arguments: {} }));
    expect(plans).toContain("'international'");
  });

  it("requires business for the fit prompt", async () => {
    await expect(
      client.getPrompt({ name: "is_udaybooking_right_for_me", arguments: {} }),
    ).rejects.toThrow();
  });

  it("mentions only tools that exist, and no prices or plan names", async () => {
    const texts = [
      textOf(await client.getPrompt({ name: "compare_plans", arguments: {} })),
      textOf(
        await client.getPrompt({ name: "is_udaybooking_right_for_me", arguments: { business: "salon" } }),
      ),
    ];
    for (const text of texts) {
      for (const name of text.match(/udaybooking_[a-z_]+/g) ?? []) {
        expect(TOOL_NAMES).toContain(name);
      }
      expect(text).not.toMatch(/\b(Free|Professional|Enterprise)\b|\b\d+%|[$₹]\s?\d/);
    }
  });
});
