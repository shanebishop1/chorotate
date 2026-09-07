import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useFetcher } from "react-router";

import type { AuthorizedMember } from "../../auth/access";
import type { HomeActionData } from "../../routes/home-action";
import { views, type ChoreRelayView } from "./model";
import { Icon, Person, toProjected } from "./shared-presentation";
import type { ChoreRelayProps, Theme } from "./types";

const labels: Record<ChoreRelayView, string> = {
  now: "Now",
  mine: "Mine",
  household: "Household",
  history: "History",
};

export function ShellChrome({
  props,
  theme,
  onToggleTheme,
  children,
}: {
  props: ChoreRelayProps;
  theme: Theme;
  onToggleTheme(): void;
  children: ReactNode;
}) {
  if (props.state === "unauthorized") {
    return (
      <div className="app-shell sign-in-shell">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <main id="main-content" className="sign-in-page" tabIndex={-1}>
          <div className="sign-in-panel">
            <span className="brand-mark" aria-hidden="true">
              <Icon name="brand" />
            </span>
            <h1>ChoRotate</h1>
            <AuthControl
              kind="sign-in"
              localAuthAvailable={props.localAuthAvailable}
            />
          </div>
        </main>
        <div className="sign-in-shutters" aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-row">
          <Link
            className="brand"
            to="?view=now"
            aria-label="ChoRotate, go to Now"
          >
            <span className="brand-mark" aria-hidden="true">
              <Icon name="brand" />
            </span>
            <span>ChoRotate</span>
          </Link>
          <div className="header-actions">
            <button
              className="icon-button theme-toggle"
              type="button"
              onClick={onToggleTheme}
              aria-label={
                theme
                  ? `Switch to ${theme === "dark" ? "light" : "dark"} mode`
                  : "Switch color mode"
              }
              title={
                theme
                  ? `Switch to ${theme === "dark" ? "light" : "dark"} mode`
                  : "Switch color mode"
              }
            >
              <span className="theme-icon theme-icon-light">
                <Icon name="moon" />
              </span>
              <span className="theme-icon theme-icon-dark">
                <Icon name="sun" />
              </span>
            </button>
            {props.state === "ready" ? (
              <ProfileMenu
                member={props.data.signedInMember}
                localAuthAvailable={props.localAuthAvailable}
              />
            ) : null}
          </div>
        </div>
        <nav className="primary-nav" aria-label="ChoRotate views">
          {views.map((view) => (
            <Link
              key={view}
              to={`?view=${view}`}
              preventScrollReset
              aria-current={props.activeView === view ? "page" : undefined}
            >
              <Icon name={view} />
              <span>{labels[view]}</span>
            </Link>
          ))}
        </nav>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

export function effectiveTheme(): Exclude<Theme, undefined> {
  const documentTheme = document.documentElement.dataset.theme;
  if (documentTheme === "light" || documentTheme === "dark")
    return documentTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(theme: Exclude<Theme, undefined>) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("chorotate-theme", theme);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#1d201c" : "#fffefa");
}

export function SystemState({
  kind,
  localAuthAvailable = false,
}: {
  kind: "unauthorized" | "unavailable" | "empty";
  localAuthAvailable?: boolean;
}) {
  const content =
    kind === "unauthorized"
      ? [
          "lock",
          "This household is private",
          "Sign in with an exact active household email to continue.",
        ]
      : kind === "empty"
        ? [
            "calendar",
            "Nothing is scheduled yet",
            "The household schedule has no assignments in this view.",
          ]
        : ["cloud", "No schedule found"];
  return (
    <div
      className={`system-state state-${kind}`}
      role={kind === "unavailable" ? "alert" : "status"}
    >
      <Icon name={content[0]} />
      <div>
        <h1>{content[1]}</h1>
        {content[2] ? <p>{content[2]}</p> : null}
        {kind === "unauthorized" ? (
          <AuthControl kind="sign-in" localAuthAvailable={localAuthAvailable} />
        ) : null}
        {kind === "empty" ? <MaterializeControl /> : null}
      </div>
    </div>
  );
}

function MaterializeControl() {
  const fetcher = useFetcher<HomeActionData>();
  const pending = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="materialize" />
      <input type="hidden" name="requestId" value="request:materialize" />
      <button
        className="button primary"
        type="submit"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Preparing schedule…" : "Prepare schedule"}
      </button>
      {fetcher.data && fetcher.data.state !== "success" ? (
        <span className="auth-status" role="alert">
          {fetcher.data.state === "conflict"
            ? "The schedule changed. Try again."
            : fetcher.data.message}
        </span>
      ) : null}
    </fetcher.Form>
  );
}

function ProfileMenu({
  member,
  localAuthAvailable,
}: {
  member: AuthorizedMember;
  localAuthAvailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuRef.current
          ?.querySelector<HTMLButtonElement>(".profile-trigger")
          ?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);
  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        className="profile-trigger"
        type="button"
        aria-label="Open profile menu"
        aria-expanded={open}
        aria-controls="profile-popover"
        onClick={() => setOpen((current) => !current)}
      >
        <Person member={toProjected(member)} size="small" />
      </button>
      <div className="profile-popover" id="profile-popover" hidden={!open}>
        <strong>{member.displayName}</strong>
        <AuthControl kind="sign-out" localAuthAvailable={localAuthAvailable} />
      </div>
    </div>
  );
}

function AuthControl({
  kind,
  localAuthAvailable,
}: {
  kind: "sign-in" | "sign-out";
  localAuthAvailable: boolean;
}) {
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  const signIn = kind === "sign-in";
  const localAuth = localAuthAvailable;
  const localSignIn = signIn && localAuth;
  async function submit() {
    setState("pending");
    try {
      const endpoint = signIn
        ? localSignIn
          ? "/api/auth/local"
          : "/api/auth/sign-in/social"
        : localAuth
          ? "/api/auth/local/sign-out"
          : "/api/auth/sign-out";
      const body =
        signIn && !localSignIn
          ? { provider: "google", callbackURL: `${window.location.origin}/` }
          : {};
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("Authentication request failed");
      if (signIn && !localSignIn) {
        const payload: unknown = await response.json();
        if (
          typeof payload !== "object" ||
          payload === null ||
          !("url" in payload) ||
          typeof payload.url !== "string"
        ) {
          throw new Error("Authentication response invalid");
        }
        const providerUrl = new URL(payload.url);
        if (providerUrl.protocol !== "https:") {
          throw new Error("Authentication response invalid");
        }
        window.location.assign(providerUrl.href);
      } else {
        window.location.assign("/");
      }
    } catch {
      setState("error");
    }
  }
  const pending = state === "pending";
  return (
    <div className="auth-control">
      <button
        className={`button ${signIn ? "primary" : "quiet"}${pending ? " is-pending" : ""}`}
        type="button"
        onClick={submit}
        disabled={pending}
        aria-busy={pending}
      >
        {signIn && !localSignIn ? (
          <svg
            className="google-mark"
            viewBox="0 0 24 24"
            role="img"
            aria-hidden="true"
          >
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285f4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34a853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#fbbc05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#ea4335"
            />
          </svg>
        ) : null}
        {localSignIn
          ? "Sign in locally"
          : signIn
            ? "Sign in with Google"
            : "Sign out"}
      </button>
      <span aria-live="polite" className="auth-status">
        {state === "error"
          ? signIn
            ? "Sign in could not be started. Try again."
            : "Sign out could not be completed. Try again."
          : ""}
      </span>
    </div>
  );
}
