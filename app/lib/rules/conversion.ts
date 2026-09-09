import type { Rule } from "./types";

/**
 * Conversion pillar — can a visitor who has decided to buy actually act?
 *
 * These carry the heaviest weights in the registry because they are the
 * failures that cost a booking outright, not the ones that cost a ranking.
 *
 * What they cannot check, and why: whether a CTA is *visible*, above the fold,
 * or contrast-legible are rendering questions. An HTML parse knows a button
 * exists; only a browser knows anyone can see it. Those rules stay unwritten
 * rather than approximated.
 *
 * Every `evidence` string is a counted measurement rather than a verdict
 * ("0 of 14 links", not "poor contact options"), because stage ③ quotes
 * evidence back verbatim as grounding and an unquantified claim is not evidence.
 */

/**
 * A currency symbol or code adjacent to a number. Deliberately narrow — "call
 * for a quote" is not a price, and matching it would report pricing where a
 * visitor finds none.
 */
const PRICE_PATTERN =
  /(?:[£$€]\s?\d)|(?:\d+(?:[.,]\d{2})?\s?(?:GBP|USD|EUR)\b)/i;

const CONTACT_SCHEMES = ["tel:", "mailto:"];

export const noCta: Rule = {
  id: "conversion.no-cta",
  pillar: "conversion",
  description:
    "The page contains no button or link-styled action a visitor could click to buy, book, or enquire.",
  severity: "critical",
  run(snapshot) {
    if (snapshot.ctas.length > 0) return null;

    return {
      title: "No call to action anywhere on the page",
      evidence: "0 buttons or link-styled actions found in the page's markup.",
      recommendation:
        "Add one primary action — book, call, or request a quote — and repeat it after each section, so a visitor never has to scroll back to act.",
      impact: 3,
      effort: 2,
    };
  },
};

export const noForm: Rule = {
  id: "conversion.no-form",
  pillar: "conversion",
  description:
    "The page contains no form a visitor could submit to start an enquiry.",
  severity: "high",
  run(snapshot) {
    if (snapshot.forms.length > 0) return null;

    return {
      title: "No enquiry form on the page",
      evidence: "0 forms found in the page's markup.",
      recommendation:
        "Add a short enquiry form — name, contact, and message is enough — so a visitor who will not phone still has a way to start the conversation.",
      impact: 3,
      effort: 2,
    };
  },
};

export const noPricing: Rule = {
  id: "conversion.no-pricing",
  pillar: "conversion",
  description:
    "The page's visible copy names no price, price range, or 'from' figure for anything it sells.",
  severity: "high",
  run(snapshot) {
    if (PRICE_PATTERN.test(snapshot.text)) return null;

    return {
      title: "No pricing anywhere on the page",
      evidence:
        "No price, range, or 'from' figure appears in the page's visible copy.",
      recommendation:
        "Publish prices, or a from-price range per service. Price is usually the first question a visitor asks, and withholding it adds an enquiry-to-quote round trip before anyone can book.",
      impact: 3,
      effort: 2,
    };
  },
};

export const noContactLink: Rule = {
  id: "conversion.no-contact-link",
  pillar: "conversion",
  description:
    "The page has no tel: or mailto: link, so a phone number or address cannot be actioned in one tap.",
  severity: "medium",
  run(snapshot) {
    const contactable = snapshot.links.some((link) =>
      CONTACT_SCHEMES.some((scheme) =>
        link.href.toLowerCase().startsWith(scheme),
      ),
    );
    if (contactable) return null;

    return {
      title: "No tappable phone or email link",
      evidence: `0 of ${snapshot.links.length} links use a tel: or mailto: scheme.`,
      recommendation:
        "Mark the phone number up as a tel: link and the address as mailto:, so a visitor on a phone can act in one tap rather than copying digits.",
      impact: 2,
      effort: 1,
    };
  },
};

export const CONVERSION_RULES: Rule[] = [
  noCta,
  noForm,
  noPricing,
  noContactLink,
];
