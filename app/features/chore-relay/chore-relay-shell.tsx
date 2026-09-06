import { useEffect, useState } from "react";

import { ReadyShell } from "./ready-shell";
import {
  ShellChrome,
  applyTheme,
  effectiveTheme,
  SystemState,
} from "./shell-chrome";
import type { ChoreRelayProps, Theme } from "./types";

export type { ChoreRelayData } from "./types";

export function ChoreRelayShell(props: ChoreRelayProps) {
  const [theme, setTheme] = useState<Theme>();
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const current = effectiveTheme();
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", current === "dark" ? "#1d201c" : "#fffefa");
      setTheme(current);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (
      props.state === "unauthorized" &&
      document.documentElement.dataset.signInIntro === "play"
    ) {
      try {
        sessionStorage.setItem("chorotate-sign-in-intro-v1", "1");
      } catch {
        document.documentElement.dataset.signInIntro = "settled";
      }
    }
  }, [props.state]);
  function toggleTheme() {
    const next = (theme ?? effectiveTheme()) === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }
  return (
    <ShellChrome props={props} theme={theme} onToggleTheme={toggleTheme}>
      {props.state === "unavailable" ? (
        <SystemState kind="unavailable" />
      ) : props.data ? (
        <ReadyShell activeView={props.activeView} data={props.data} />
      ) : (
        <SystemState kind="unavailable" />
      )}
    </ShellChrome>
  );
}
