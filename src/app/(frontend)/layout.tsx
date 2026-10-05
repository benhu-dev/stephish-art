import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Steph's Photobooth · Stephish.art",
  description: "Meet Stephish and visit her online portrait photobooth, inspired by New York park pop-ups.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
