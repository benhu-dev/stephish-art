import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A little piece of New York · Stephish.art",
  description: "A handmade postcard machine in an illustrated New York park. Scroll to insert a coin and print a keepsake.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
