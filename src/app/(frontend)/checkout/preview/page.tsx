import { notFound } from "next/navigation";
import { PortraitCheckoutPreview } from "@/features/checkout/components/PortraitCheckoutPreview";

export default function CheckoutPreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PortraitCheckoutPreview />;
}
