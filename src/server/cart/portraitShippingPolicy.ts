import { StorefrontApiError } from "../storefront/storefrontApiError";

export type PortraitShippingRegion = "us" | "international";
export const PORTRAIT_POLICY_VERSION = "portrait-final-sale-v1";
// Concrete destinations in installed Stripe 22.6.2 SessionCreateParams.
// ZZ is an unknown-country placeholder, not a destination. Final launch list is pending.
export const PORTRAIT_SHIPPING_COUNTRIES = Object.freeze(
  "AC AD AE AF AG AI AL AM AO AQ AR AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CV CW CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IS IT JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MK ML MM MN MO MQ MR MS MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SZ TA TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VN VU WF WS XK YE YT ZA ZM ZW".split(
    " ",
  ),
);

export const portraitShipping = (region: PortraitShippingRegion) => {
  if (region !== "us" && region !== "international") {
    throw new StorefrontApiError(400, "INVALID_SHIPPING_REGION");
  }
  return {
    allowedCountries:
      region === "us"
        ? ["US"]
        : PORTRAIT_SHIPPING_COUNTRIES.filter((country) => country !== "US"),
    amountCents: region === "us" ? 1000 : 500,
    label:
      region === "us"
        ? "USPS Shipping + Tracking"
        : "International Shipping (untracked)",
    region,
    tracked: region === "us",
  };
};

export type PortraitCheckoutRequest = {
  policyAccepted: true;
  shippingRegion: PortraitShippingRegion;
};

export const parsePortraitCheckoutRequest = (
  value: unknown,
): PortraitCheckoutRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontApiError(400, "INVALID_REQUEST");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "policyAccepted,shippingRegion") {
    throw new StorefrontApiError(400, "INVALID_REQUEST");
  }
  if (input.policyAccepted !== true)
    throw new StorefrontApiError(422, "POLICY_ACCEPTANCE_REQUIRED");
  const shipping = portraitShipping(
    input.shippingRegion as PortraitShippingRegion,
  );
  return { policyAccepted: true, shippingRegion: shipping.region };
};
