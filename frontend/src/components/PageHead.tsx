import Link from "next/link";
import type { ReactNode } from "react";

type Crumb = { href: string; label: string };

type Props = {
  title: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
};

export function PageHead({ title, eyebrow, meta, crumbs, actions }: Props) {
  return (
    <header className="page-head">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <p className="breadcrumb">
            {crumbs.map((c, i) => (
              <span key={c.href}>
                {i > 0 && " / "}
                <Link href={c.href}>{c.label}</Link>
              </span>
            ))}
          </p>
        </nav>
      )}
      <div className="page-head-row">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {meta && <p className="page-meta">{meta}</p>}
        </div>
        {actions && <div className="page-head-actions">{actions}</div>}
      </div>
    </header>
  );
}
