import type { ReactNode } from "react";

export function LegalPage({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="app-shell legal-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="legal-header">
        <a className="brand" href="/" aria-label="ChoRotate home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          ChoRotate
        </a>
        <a className="legal-home-link" href="/">
          Return home
        </a>
      </header>
      <main id="main-content" className="legal-main" tabIndex={-1}>
        <div className="legal-heading">
          <p className="eyebrow">House rules</p>
          <h1>{title}</h1>
          <p>{description}</p>
          <span>Effective September 2, 2026</span>
        </div>
        <article className="legal-document">{children}</article>
      </main>
      <footer className="legal-footer">
        <p>One home. Clear handoffs.</p>
        <nav aria-label="Legal">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>
    </div>
  );
}
