import type { Metadata } from "next";

import { CheckoutResultLayout } from "@/features/checkout/components/CheckoutResultLayout";
import { CheckoutSuccessStatus } from "@/features/checkout/components/CheckoutSuccessStatus";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Checkout status · Stephish.art",
};

export default function CheckoutSuccessPage() {
  return (
    <CheckoutResultLayout>
      <CheckoutSuccessStatus />
    </CheckoutResultLayout>
  );
}
