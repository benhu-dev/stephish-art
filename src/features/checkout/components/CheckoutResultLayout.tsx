import type { ReactNode } from "react";

import styles from "./checkout-result.module.css";

export function CheckoutResultLayout({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className={styles.page}>
      <div aria-hidden="true" className={styles.skyline} />
      <main className={styles.card}>
        <div aria-hidden="true" className={styles.postmark}>
          NYC
        </div>
        {title ? <h1 className={styles.title}>{title}</h1> : null}
        {children}
      </main>
    </div>
  );
}
