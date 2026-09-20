import type { Metadata } from "next";

import { CheckoutCancelledActions } from "@/features/checkout/components/CheckoutCancelledActions";
import { CheckoutResultLayout } from "@/features/checkout/components/CheckoutResultLayout";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Checkout cancelled · Stephish.art",
};

export default function CheckoutCancelledPage() {
  return (
    <CheckoutResultLayout title="Payment was not completed.">
      <p>No Order was created by visiting this page.</p>
      <p>You can safely return home or try the same protected checkout again.</p>
      <CheckoutCancelledActions />
    </CheckoutResultLayout>
  );
}
