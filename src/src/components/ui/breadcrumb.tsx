import type { ComponentProps } from "react";

export function Breadcrumb(props: ComponentProps<"nav">) {
  return <nav aria-label="Breadcrumb" {...props} />;
}

export function BreadcrumbList(props: ComponentProps<"ol">) {
  return <ol className="gen-breadcrumb-list" {...props} />;
}

export function BreadcrumbItem(props: ComponentProps<"li">) {
  return <li className="gen-breadcrumb-item" {...props} />;
}

export function BreadcrumbLink(props: ComponentProps<"button">) {
  return <button type="button" className="gen-breadcrumb-link" {...props} />;
}

export function BreadcrumbPage(props: ComponentProps<"span">) {
  return (
    <span aria-current="page" className="gen-breadcrumb-page" {...props} />
  );
}

export function BreadcrumbSeparator(props: ComponentProps<"span">) {
  return (
    <span aria-hidden="true" className="gen-breadcrumb-separator" {...props}>
      /
    </span>
  );
}
