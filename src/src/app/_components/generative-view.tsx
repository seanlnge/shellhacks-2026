"use client";

import {
  createSpecStreamCompiler,
  type Spec,
  type UIElement,
} from "@json-render/core";
import {
  defineRegistry,
  Renderer,
  StateProvider,
  VisibilityProvider,
} from "@json-render/react";
import {
  Children,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { catalog } from "~/lib/generative-catalog";

type Metric = {
  label: string;
  value: number;
  display: string;
  sourceId: string;
};
type Series = {
  label: string;
  unit: string;
  points: { date: string; value: number }[];
  sourceId: string;
};
type Source = {
  label: string;
  url: string;
  excerpt?: string;
  text?: string;
  publishedAt?: string;
};
type Bundle = {
  story: {
    id: number;
    holding: { ticker: string; name: string };
    metrics: Record<string, Metric>;
    series: Record<string, Series>;
    sources: Record<string, Source>;
    events: { id: string; date: string; label: string; sourceId: string }[];
  };
};
type Anchor = {
  elementId?: string;
  elementType: string;
  elementProps: Record<string, unknown>;
  selectedText?: string;
  userPrompt?: string;
};
type ViewContext = {
  bundle: Bundle | null;
  spec: Spec | null;
  ask: (question: string, anchor?: Anchor) => void;
};
const View = createContext<ViewContext>({
  bundle: null,
  spec: null,
  ask: () => undefined,
});
const DashboardColumns = createContext(2);

function EmptyData() {
  return <p className="gen-empty">No sourced data available for this view.</p>;
}
function SourceLink({ sourceId }: { sourceId: string }) {
  const source = useContext(View).bundle?.story.sources[sourceId];
  return source && /^https:\/\//i.test(source.url) ? (
    <a
      className="gen-source"
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {source.label} ↗
    </a>
  ) : null;
}
function MetricCard({
  metricRef,
  label,
}: {
  metricRef: string;
  label?: string;
}) {
  const metric = useContext(View).bundle?.story.metrics[metricRef];
  if (!metric) return <EmptyData />;
  return (
    <div className="gen-metric">
      <span className="eyebrow">{label ?? metric.label}</span>
      <strong>{metric.display}</strong>
      <SourceLink sourceId={metric.sourceId} />
    </div>
  );
}
function Chart({
  refs,
  title,
  mode,
}: {
  refs: string[];
  title?: string;
  mode: "line" | "bar";
}) {
  const { bundle, ask } = useContext(View);
  const series = refs
    .map((ref) => ({ ref, data: bundle?.story.series[ref] }))
    .filter(
      (entry): entry is { ref: string; data: Series } =>
        !!entry.data?.points.length,
    );
  if (!series.length) return <EmptyData />;
  const values = series
    .flatMap(({ data }) => data.points.map((point) => point.value))
    .filter(Number.isFinite);
  if (!values.length) return <EmptyData />;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const dates = [
    ...new Set(series.flatMap(({ data }) => data.points.map((p) => p.date))),
  ].sort();
  const x = (date: string) =>
    42 + (dates.indexOf(date) / Math.max(1, dates.length - 1)) * 550;
  const y = (value: number) => 165 - ((value - min) / range) * 135;
  return (
    <figure className="gen-chart">
      <figcaption>
        {title ?? series.map(({ data }) => data.label).join(" / ")}
      </figcaption>
      <svg
        viewBox="0 0 620 200"
        role="img"
        aria-label={`${mode === "line" ? "Line" : "Bar"} chart: ${series.map(({ data }) => data.label).join(", ")}`}
      >
        <line x1="42" x2="592" y1="165" y2="165" className="gen-axis" />
        <line x1="42" x2="592" y1="30" y2="30" className="gen-gridline" />
        {series.map(({ ref, data }, index) => {
          const points = data.points
            .filter((p) => Number.isFinite(p.value))
            .sort((a, b) => a.date.localeCompare(b.date));
          return (
            <g key={ref}>
              {mode === "line" && points.length > 1 && (
                <polyline
                  fill="none"
                  className="gen-chart-line"
                  strokeWidth={index === 0 ? 2.5 : 1.5}
                  strokeDasharray={index % 2 ? "6 4" : undefined}
                  points={points
                    .map((p) => `${x(p.date)},${y(p.value)}`)
                    .join(" ")}
                />
              )}
              {points.map((point) => {
                const left =
                  x(point.date) +
                  (mode === "bar"
                    ? (index - (series.length - 1) / 2) *
                      Math.min(30, 55 / series.length)
                    : 0);
                const explanation = `${data.label} on ${point.date}: ${point.value}${data.unit ? ` ${data.unit}` : ""}`;
                return mode === "bar" ? (
                  <rect
                    key={point.date}
                    x={left - Math.min(12, 24 / series.length) / 2}
                    y={Math.min(y(point.value), y(0))}
                    width={Math.min(12, 24 / series.length)}
                    height={Math.max(1, Math.abs(y(point.value) - y(0)))}
                    className={`gen-bar gen-bar-${index % 4}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Explore ${explanation}`}
                    onClick={() =>
                      ask(`Explain ${explanation}`, {
                        elementType: "BarChart",
                        elementProps: {
                          seriesRefs: refs,
                          date: point.date,
                          value: point.value,
                        },
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        ask(`Explain ${explanation}`, {
                          elementType: "BarChart",
                          elementProps: {
                            seriesRefs: refs,
                            date: point.date,
                            value: point.value,
                          },
                        });
                      }
                    }}
                  >
                    <title>{explanation}</title>
                  </rect>
                ) : (
                  <circle
                    key={point.date}
                    cx={left}
                    cy={y(point.value)}
                    r="5"
                    className="gen-point"
                    role="button"
                    tabIndex={0}
                    aria-label={`Explore ${explanation}`}
                    onClick={() =>
                      ask(`Explain ${explanation}`, {
                        elementType: "LineChart",
                        elementProps: {
                          seriesRefs: refs,
                          date: point.date,
                          value: point.value,
                        },
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        ask(`Explain ${explanation}`, {
                          elementType: "LineChart",
                          elementProps: {
                            seriesRefs: refs,
                            date: point.date,
                            value: point.value,
                          },
                        });
                      }
                    }}
                  >
                    <title>{explanation}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
        <text x="42" y="188">
          {dates[0]}
        </text>
        <text x="592" y="188" textAnchor="end">
          {dates[dates.length - 1]}
        </text>
      </svg>
      <div className="gen-legend">
        {series.map(({ ref, data }, index) => (
          <span key={ref}>
            <i className={`gen-legend-mark gen-bar-${index % 4}`} />
            {data.label} <small>{data.unit}</small>
          </span>
        ))}
      </div>
      <div className="gen-chart-sources">
        {[...new Set(series.map(({ data }) => data.sourceId))].map((id) => (
          <SourceLink key={id} sourceId={id} />
        ))}
      </div>
    </figure>
  );
}

const { registry: baseRegistry } = defineRegistry(catalog, {
  components: {
    Deck: ({ props, children }) => {
      const slides = Children.toArray(children);
      const [index, setIndex] = useState(0);
      const current = Math.min(index, Math.max(0, slides.length - 1));
      return (
        <div
          className="gen-deck"
          aria-label={props.title}
          onKeyDown={(event) => {
            if (
              event.target !== event.currentTarget &&
              (event.target as HTMLElement).closest("input,textarea,button,a")
            )
              return;
            if (event.key === "ArrowRight")
              setIndex(Math.min(current + 1, slides.length - 1));
            if (event.key === "ArrowLeft") setIndex(Math.max(current - 1, 0));
          }}
          tabIndex={0}
        >
          <div className="gen-deck-header">
            <span className="eyebrow">{props.title}</span>
            <span className="eyebrow">
              {slides.length
                ? `${String(current + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`
                : "GENERATING"}
            </span>
          </div>
          {slides[current] ?? (
            <p className="gen-empty">Preparing your briefing…</p>
          )}
          <div className="gen-deck-nav">
            <button
              disabled={current === 0}
              onClick={() => setIndex(current - 1)}
            >
              ← Previous
            </button>
            <div
              className="gen-progress"
              role="progressbar"
              aria-label="Briefing progress"
              aria-valuenow={slides.length ? current + 1 : 0}
              aria-valuemin={0}
              aria-valuemax={slides.length}
            >
              <span
                style={{
                  width: `${slides.length ? ((current + 1) / slides.length) * 100 : 0}%`,
                }}
              />
            </div>
            <button
              disabled={current >= slides.length - 1}
              onClick={() => setIndex(current + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      );
    },
    Dashboard: ({ props, children }) => (
      <DashboardColumns.Provider value={props.columns ?? 2}>
        <div className="gen-dashboard">
          <p className="eyebrow">PORTFOLIO INTELLIGENCE</p>
          <h2>{props.title}</h2>
          <div className="gen-dashboard-grid">{children}</div>
        </div>
      </DashboardColumns.Provider>
    ),
    Section: ({ props, children }) => {
      const columns = useContext(DashboardColumns);
      return (
        <section
          className="gen-section"
          style={{
            gridColumn: `span ${Math.min(12, (12 / columns) * (props.span ?? 1))}`,
          }}
        >
          <h3>{props.title}</h3>
          {children}
        </section>
      );
    },
    StorySlide: ({ props, children }) => (
      <section className="gen-slide">
        <p className="eyebrow">{props.kicker}</p>
        <h2>{props.title}</h2>
        <div className="gen-evidence">{children}</div>
      </section>
    ),
    Summary: ({ props }) => (
      <details className="gen-summary" open={!props.expandedText}>
        <summary>{props.text}</summary>
        {props.expandedText && <p>{props.expandedText}</p>}
      </details>
    ),
    BigNumber: ({ props }) => (
      <div>
        <MetricCard metricRef={props.metricRef} label={props.label} />
        {props.compareRef && (
          <div className="gen-compare">
            <MetricCard metricRef={props.compareRef} />
          </div>
        )}
      </div>
    ),
    KPIGrid: ({ props }) => (
      <div className="gen-kpi-grid">
        {props.metricRefs.map((ref) => (
          <MetricCard key={ref} metricRef={ref} />
        ))}
      </div>
    ),
    LineChart: ({ props }) => (
      <Chart refs={props.seriesRefs} title={props.title} mode="line" />
    ),
    BarChart: ({ props }) => (
      <Chart refs={props.seriesRefs} title={props.title} mode="bar" />
    ),
    Timeline: () => {
      const events = useContext(View).bundle?.story.events;
      return events?.length ? (
        <ol className="gen-timeline">
          {events.map((event) => (
            <li key={event.id}>
              <time>{event.date}</time>
              <span>{event.label}</span>
              <SourceLink sourceId={event.sourceId} />
            </li>
          ))}
        </ol>
      ) : (
        <EmptyData />
      );
    },
    FilingExcerpt: ({ props }) => {
      const source = useContext(View).bundle?.story.sources[props.chunkId];
      return source?.excerpt || source?.text ? (
        <blockquote className="gen-excerpt">
          <p>“{source.excerpt ?? source.text}”</p>
          {props.note && <small>{props.note}</small>}
          <footer>
            <SourceLink sourceId={props.chunkId} />
          </footer>
        </blockquote>
      ) : (
        <EmptyData />
      );
    },
    SourceChips: ({ props }) => (
      <div className="gen-sources">
        {props.sourceIds.map((id) => (
          <SourceLink key={id} sourceId={id} />
        ))}
      </div>
    ),
    AskFollowup: ({ props }) => {
      const { ask } = useContext(View);
      return (
        <div className="gen-followups">
          <span className="eyebrow">CONTINUE THE RESEARCH</span>
          {props.suggestions.map((question) => (
            <button key={question} onClick={() => ask(question)}>
              {question} ↗
            </button>
          ))}
        </div>
      );
    },
    KeyTakeaways: ({ props }) => (
      <ul className="gen-takeaways">
        {props.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    ),
    RiskFlag: ({ props }) => (
      <aside className="gen-note">
        <span className="eyebrow">{props.severity} / RISK TO WATCH</span>
        <p>{props.text}</p>
      </aside>
    ),
    Callout: ({ props }) => <aside className="gen-note">{props.text}</aside>,
    ExplainTerm: ({ props }) => (
      <div className="gen-term">
        <strong>{props.term}</strong>
        <p>{props.definition}</p>
      </div>
    ),
  },
});

function Anchorable({
  element,
  children,
}: {
  element: UIElement;
  children: ReactNode;
}) {
  const { ask, spec } = useContext(View);
  const [prompting, setPrompting] = useState(false);
  const [question, setQuestion] = useState("");
  const entry = Object.entries(spec?.elements ?? {}).find(
    ([, candidate]) =>
      candidate.type === element.type &&
      JSON.stringify(candidate.props) === JSON.stringify(element.props),
  );
  const anchor: Anchor = {
    elementId: entry?.[0],
    elementType: element.type,
    elementProps: element.props,
  };
  return (
    <div className="gen-anchor">
      {children}
      <button
        type="button"
        className="gen-anchor-trigger"
        onClick={() => setPrompting(!prompting)}
        aria-expanded={prompting}
      >
        Explore this {element.type === "StorySlide" ? "story" : "detail"} ↗
      </button>
      {prompting && (
        <form
          className="gen-anchor-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (question.trim()) {
              ask(question.trim(), {
                ...anchor,
                selectedText:
                  window.getSelection()?.toString().trim() ?? undefined,
                userPrompt: question.trim(),
              });
              setPrompting(false);
              setQuestion("");
            }
          }}
        >
          <label>
            ASK ABOUT THIS DETAIL
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={500}
              required
              placeholder="Why does this matter?"
              autoFocus
            />
          </label>
          <button type="submit">Ask ↗</button>
        </form>
      )}
    </div>
  );
}
const registry = Object.fromEntries(
  Object.entries(baseRegistry).map(([name, Component]) => [
    name,
    (props: React.ComponentProps<typeof Component>) =>
      name === "Deck" || name === "Dashboard" ? (
        <Component {...props} />
      ) : (
        <Anchorable element={props.element}>
          <Component {...props} />
        </Anchorable>
      ),
  ]),
) as typeof baseRegistry;

export function GenerativeView({
  portfolioId,
  storyId,
  question,
  onClose,
}: {
  portfolioId: number;
  storyId: number;
  question: string;
  onClose: () => void;
}) {
  const [spec, setSpec] = useState<Spec | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [askText, setAskText] = useState("");
  const [history, setHistory] = useState<
    { spec: Spec; bundle: Bundle | null; question: string }[]
  >([]);
  const abort = useRef<AbortController | null>(null);

  async function generate(nextQuestion: string, anchor?: Anchor, push = true) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    if (push && spec)
      setHistory((prev) => [...prev, { spec, bundle, question }]);
    setSpec(null);
    setBundle(null);
    setError("");
    setLoading(true);
    const query = new URLSearchParams({
      portfolioId: String(portfolioId),
      storyId: String(storyId),
    });
    const dataRequest = fetch(`/api/story-data?${query}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Story data is unavailable.");
        return response.json() as Promise<Bundle>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setBundle(data);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Story data is unavailable.",
          );
      });
    try {
      const response = await fetch("/api/deepdive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolioId,
          storyId,
          question: nextQuestion,
          ...(anchor ? { anchor } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error(
          (await response.text()).slice(0, 250) ||
            "Unable to generate the briefing.",
        );
      const compiler = createSpecStreamCompiler<Spec>({
        root: "",
        elements: {},
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        const chunk = decoder.decode(value, { stream: !done });
        const { result, newPatches } = compiler.push(
          done ? `${chunk}\n` : chunk,
        );
        if (
          newPatches.length &&
          result.root &&
          result.elements?.[result.root] &&
          !controller.signal.aborted
        )
          setSpec({ ...result, elements: { ...result.elements } });
        if (done) break;
      }
      if (!compiler.getResult().elements?.[compiler.getResult().root])
        throw new Error("No briefing was generated.");
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to generate the briefing.",
        );
    } finally {
      await dataRequest;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const generateRef = useRef(generate);
  generateRef.current = generate;
  useEffect(() => {
    void generateRef.current(question, undefined, false);
    return () => abort.current?.abort();
  }, [portfolioId, storyId, question]);
  function goBack() {
    abort.current?.abort();
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setSpec(previous.spec);
    setBundle(previous.bundle);
    setError("");
    setLoading(false);
  }

  return (
    <div
      className="gen-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Generated portfolio briefing"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="gen-toolbar">
        <span className="brand">
          folio<span className="brand-dot">.</span>fm
        </span>
        <nav aria-label="Briefing navigation">
          <button disabled={!history.length} onClick={goBack}>
            ← Back {history.length ? `(${history.length})` : ""}
          </button>
          <span className="eyebrow">
            {history.length ? "FOLLOW-UP RESEARCH" : "PERSONAL DEEP DIVE"}
          </span>
        </nav>
        <button onClick={onClose} aria-label="Close briefing">
          Close ×
        </button>
      </div>
      <div className="gen-content" aria-live="polite">
        {spec && (
          <View.Provider
            value={{
              bundle,
              spec,
              ask: (text, anchor) => void generate(text, anchor),
            }}
          >
            <StateProvider
              key={`${storyId}-${history.length}-${bundle ? "loaded" : "empty"}`}
              initialState={bundle ?? {}}
            >
              <VisibilityProvider>
                <Renderer spec={spec} registry={registry} />
              </VisibilityProvider>
            </StateProvider>
          </View.Provider>
        )}
        {loading && (
          <p className="gen-status" role="status">
            {spec ? "Adding to your briefing…" : "Preparing your briefing…"}
          </p>
        )}
        {error && (
          <p className="gen-status error" role="alert">
            {error}
          </p>
        )}
        {!loading && !spec && !error && <EmptyData />}
      </div>
      <form
        className="gen-ask"
        onSubmit={(event) => {
          event.preventDefault();
          if (askText.trim()) {
            void generate(askText.trim());
            setAskText("");
          }
        }}
      >
        <label htmlFor="gen-ask-input" className="eyebrow">
          ASK ANYTHING ABOUT THIS STORY
        </label>
        <div>
          <input
            id="gen-ask-input"
            placeholder="What should I understand next?"
            value={askText}
            onChange={(event) => setAskText(event.target.value)}
            maxLength={500}
            required
          />
          <button disabled={loading}>Explore ↗</button>
        </div>
      </form>
    </div>
  );
}
