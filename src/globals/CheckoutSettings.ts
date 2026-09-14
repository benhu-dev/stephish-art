import type { GlobalConfig, PayloadRequest } from "payload";

const isAuthenticated = ({ req: { user } }: { req: PayloadRequest }) =>
  Boolean(user);

export const CheckoutSettings: GlobalConfig = {
  slug: "checkout-settings",
  label: "Checkout Settings",
  access: {
    read: isAuthenticated,
    update: isAuthenticated,
  },
  admin: {
    group: "Settings",
  },
  fields: [
    {
      name: "minimumAmountCents",
      label: "Minimum Payment Amount (cents)",
      type: "number",
      admin: {
        description: "Enter an integer number of cents. 500 = $5.00.",
      },
      defaultValue: 500,
      min: 1,
      required: true,
      validate: (value: unknown) => {
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          !Number.isInteger(value)
        ) {
          return "Minimum payment amount must be a finite integer number of cents.";
        }

        return value >= 1 || "Minimum payment amount must be at least one cent.";
      },
    },
  ],
};
