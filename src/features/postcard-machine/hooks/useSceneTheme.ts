"use client";

import { useEffect, useState } from "react";
import { calculateTheme, type SceneTheme } from "../lib/theme";

export function useSceneTheme() {
  const [theme, setTheme] = useState<SceneTheme>("day");
  useEffect(() => {
    const update = () => setTheme(calculateTheme(
      new Date().getHours(), new URLSearchParams(window.location.search).get("theme"),
    ));
    update();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("popstate", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return theme;
}
