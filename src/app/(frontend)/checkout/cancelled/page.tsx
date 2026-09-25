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
    <CheckoutResultLayout title="Payment not completed">
      <p>No Order was created by visiting this page.</p>
      <p>Resume the protected checkout, or explicitly start a new order.</p>
      <CheckoutCancelledActions />
    </CheckoutResultLayout>
  );
}
