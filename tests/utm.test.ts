import { describe, expect, it } from "vitest";
import { withUtm } from "../src/utils/utm.js";

describe("withUtm", () => {
  it("adds source, medium and campaign to an own-site URL", () => {
    const url = new URL(withUtm("https://udaybooking.com/in/pricing", "udaybooking_get_pricing"));
    expect(url.searchParams.get("utm_source")).toBe("mcp");
    expect(url.searchParams.get("utm_medium")).toBe("ai_agent");
    expect(url.searchParams.get("utm_campaign")).toBe("udaybooking_get_pricing");
  });

  it("keeps existing query parameters and the fragment", () => {
    const out = withUtm("https://www.udaybooking.com/docs?a=1#frag", "t");
    const url = new URL(out);
    expect(url.searchParams.get("a")).toBe("1");
    expect(url.hash).toBe("#frag");
    expect(url.searchParams.get("utm_campaign")).toBe("t");
  });

  it("leaves external and other-subdomain URLs alone", () => {
    for (const u of ["https://example.com/x", "https://sub.udaybooking.com/", "not a url"]) {
      expect(withUtm(u, "t")).toBe(u);
    }
  });

  it("is idempotent and never overwrites an existing utm value", () => {
    const once = withUtm("https://udaybooking.com/?utm_campaign=newsletter", "t");
    expect(withUtm(once, "other")).toBe(once);
    expect(new URL(once).searchParams.get("utm_campaign")).toBe("newsletter");
  });
});
