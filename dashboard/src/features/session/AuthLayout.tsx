import type { ReactNode } from "react";

interface AuthLayoutProps {
  readonly title: string;
  readonly description: string;
  /** Optional icon shown inside the logo chip (e.g. the banned shield). */
  readonly icon?: ReactNode;
  /** Extra classes for the logo chip when it is not the default favicon. */
  readonly logoClassName?: string;
  readonly children: ReactNode;
}

/**
 * Shared auth frame for login, setup, and banned surfaces.
 *
 * A centered card on the page background — the brand block + form, no key art
 * and no distribution links. Inside the console shell (error boundary) the
 * split falls back to a solid gradient.
 */
export default function AuthLayout({
  title,
  description,
  icon,
  logoClassName = "",
  children,
}: AuthLayoutProps): ReactNode {
  return (
    <main className="auth-viewport">
      <div className="auth-image-col" role="presentation" aria-hidden="true" />
      <section className="auth-form-col">
        <div className="auth-form-inner">
          <div className="auth-brand-head">
            <div className={`auth-logo ${logoClassName}`.trim()} aria-hidden="true">
              {icon}
            </div>
            <h1 className="auth-title">{title}</h1>
            <p className="auth-desc">{description}</p>
          </div>

          <div className="auth-form-body">{children}</div>
        </div>
      </section>
    </main>
  );
}
