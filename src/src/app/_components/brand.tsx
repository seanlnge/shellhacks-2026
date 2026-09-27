import { CircleSlash } from "lucide-react";

export function Brand() {
  return (
    <span className="brand">
      <CircleSlash aria-hidden="true" className="brand-mark" />
      <span>Infinifolio</span>
    </span>
  );
}
