import type { HTMLAttributes } from "react";

export function Skeleton({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`skeleton ${className}`} aria-hidden="true" {...props} />
  );
}
