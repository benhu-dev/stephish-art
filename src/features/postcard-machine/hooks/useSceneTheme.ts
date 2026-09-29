"use client";

import { useEffect, useState } from "react";
import { startSceneThemeMonitor, type SceneTheme } from "../lib/theme";

export function useSceneTheme() {
  const [theme, setTheme] = useState<SceneTheme>("day");
  useEffect(
    () =>
      startSceneThemeMonitor({
        addPopstateListener(callback) {
          window.addEventListener("popstate", callback);
          return () => window.removeEventListener("popstate", callback);
        },
        now: () => new Date(),
        onTheme: setTheme,
        readOverride: () =>
          new URLSearchParams(window.location.search).get("theme"),
        setRecurringUpdate(callback, milliseconds) {
          const timer = window.setInterval(callback, milliseconds);
          return () => window.clearInterval(timer);
        },
      }),
    [],
  );
  return theme;
}
