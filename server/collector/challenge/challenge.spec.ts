// @vitest-environment node

import { describe, expect, it } from "vitest";

import { challengeMessage, detectChallenge } from "./challenge.ts";

describe("detectChallenge", () => {
  it.each([
    ["Just a moment...", "Verifying you are human. This may take a few seconds.", "cloudflare"],
    ["Just a moment...", "Checking your browser before accessing example.com.", "cloudflare"],
    ["Attention Required! | Cloudflare", "Sorry, you have been blocked.", "cloudflare"],
    ["example.com", "Enable JavaScript and cookies to continue", "cloudflare"],
    ["Sucuri WebSite Firewall - Access Denied", "Access Denied", "sucuri"],
    ["Wordfence", "Your access to this site has been limited by the site owner", "wordfence"],
    ["Request unsuccessful", "Request unsuccessful. Incapsula incident ID 1234", "imperva"],
  ])("flags %s as %s", (title, text, vendor) => {
    expect(detectChallenge(title, text)).toEqual({ challenged: true, vendor });
  });

  it("flags generic wording without attributing a vendor", () => {
    expect(detectChallenge("Hold on", "Please wait while we verify your request.")).toEqual({
      challenged: true,
      vendor: null,
    });
  });

  it("passes an ordinary page through", () => {
    expect(
      detectChallenge("Riverside Dental", "Gentle dentistry on the river. Book today."),
    ).toEqual({ challenged: false, vendor: null });
  });

  it("does not flag a long article that merely discusses Cloudflare", () => {
    // The length guard is the whole defence here: a real page about WAFs
    // contains every marker string, and a holding page contains almost no copy.
    const article = `How Cloudflare's checking your browser page works. ${"Lorem ipsum dolor sit amet. ".repeat(80)}`;

    expect(article.length).toBeGreaterThan(1200);
    expect(detectChallenge("Understanding DDoS protection by Cloudflare", article)).toEqual({
      challenged: false,
      vendor: null,
    });
  });

  it("handles a missing title", () => {
    expect(detectChallenge(null, "Checking your browser").challenged).toBe(true);
    expect(detectChallenge(null, "").challenged).toBe(false);
  });
});

describe("challengeMessage", () => {
  it("names the vendor when one was identified", () => {
    expect(challengeMessage("cloudflare")).toContain("cloudflare's browser check");
  });

  it("stays generic when one was not", () => {
    expect(challengeMessage(null)).toContain("a browser check");
  });
});
