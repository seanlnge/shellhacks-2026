"use client";

import { defineRegistry, Renderer } from "@json-render/react";

import { Brand } from "~/app/_components/brand";
import { briefingCatalog } from "~/lib/briefing";

const { registry } = defineRegistry(briefingCatalog, {
  components: {
    Deck: ({ children }) => <div className="deck-track">{children}</div>,
    Cover: ({ props }) => (
      <section className="deck-slide deck-cover">
        <span className="eyebrow">{props.eyebrow}</span>
        <h2>{props.title}</h2>
        <p>{props.subtitle}</p>
        <span className="slide-hint">SCROLL TO EXPLORE →</span>
      </section>
    ),
    Insight: ({ props }) => (
      <section className="deck-slide deck-insight">
        <span className="slide-number">{props.number} / THE DETAILS</span>
        <h2>{props.heading}</h2>
        <p>{props.body}</p>
      </section>
    ),
    Source: ({ props }) => {
      const safeUrl = /^https:\/\//i.test(props.url) ? props.url : null;
      return (
        <section className="deck-slide deck-source">
          <span className="eyebrow">THE ORIGINAL SOURCE</span>
          <h2>Stay close to the facts.</h2>
          <p>
            This briefing is based on reporting from {props.label}. Always check
            the original source before making decisions.
          </p>
          {safeUrl && (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button"
            >
              Read original source ↗
            </a>
          )}
        </section>
      );
    },
  },
});

export function BriefingDeck({
  spec,
  onClose,
}: {
  spec: Parameters<typeof Renderer>[0]["spec"];
  onClose: () => void;
}) {
  return (
    <div
      className="deck-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Interactive briefing"
    >
      <div className="deck-toolbar">
        <Brand />
        <span>YOUR PERSONAL DEEP DIVE</span>
        <button onClick={onClose} aria-label="Close briefing">
          Close ×
        </button>
      </div>
      <Renderer spec={spec} registry={registry} />
    </div>
  );
}
