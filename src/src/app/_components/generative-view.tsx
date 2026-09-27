"use client";

import {
  createSpecStreamCompiler,
  type Spec,
  type UIElement,
} from "@json-render/core";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import {
  Children,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { catalog } from "~/lib/generative-catalog";
import { Brand } from "~/app/_components/brand";
import { Skeleton } from "~/components/ui/skeleton";

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
  evidenceSources: Record<string, Source>;
  spec: Spec | null;
  portfolioId: number;
  storyId: number;
  registerSource: (id: string, source: Source) => void;
  ask: (question: string, anchor?: Anchor) => void;
  explore: (anchor: Anchor) => void;
  sourceNumbers: Record<string, number>;
  setPageIndex: (index: number) => void;
};
const View = createContext<ViewContext>({
  bundle: null,
  evidenceSources: {},
  spec: null,
  portfolioId: 0,
  storyId: 0,
  registerSource: () => undefined,
  ask: () => undefined,
  explore: () => undefined,
  sourceNumbers: {},
  setPageIndex: () => undefined,
});
const DashboardColumns = createContext(2);

const marketSourceId = (assetKey: string, range: string) =>
  `market:${assetKey}:${range}`;

const formatCents = (value: number) =>
  (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);

function sourceFor(
  id: string,
  bundle: Bundle | null,
  evidence: Record<string, Source>,
) {
  const source = bundle?.story.sources[id] ?? evidence[id];
  if (!source) return null;
  try {
    const url = new URL(source.url);
    return url.protocol === "https:" &&
      url.hostname &&
      !url.username &&
      !url.password
      ? source
      : null;
  } catch {
    return null;
  }
}

function referencedSources(
  spec: Spec,
  id: string,
  bundle: Bundle | null,
): string[] {
  const found = new Set<string>();
  const visited = new Set<string>();
  function visit(key: string) {
    if (visited.has(key)) return;
    visited.add(key);
    const node = spec.elements[key];
    if (!node) return;
    const props = node.props;
    const ids = [
      ...(Array.isArray(props.sourceIds)
        ? (props.sourceIds as unknown[]).filter(
            (sourceId): sourceId is string => typeof sourceId === "string",
          )
        : []),
      props.sourceId,
      ...(Array.isArray(props.metricRefs)
        ? props.metricRefs.map(
            (ref) => bundle?.story.metrics[String(ref)]?.sourceId,
          )
        : []),
      ...(Array.isArray(props.seriesRefs)
        ? props.seriesRefs.map(
            (ref) => bundle?.story.series[String(ref)]?.sourceId,
          )
        : []),
      bundle?.story.metrics[String(props.metricRef)]?.sourceId,
      bundle?.story.metrics[String(props.compareRef)]?.sourceId,
      props.chunkId,
      ...(node.type === "MarketChart" &&
      typeof props.assetKey === "string" &&
      typeof props.range === "string"
        ? [marketSourceId(props.assetKey, props.range)]
        : []),
      ...(node.type === "Timeline"
        ? (bundle?.story.events.map((event) => event.sourceId) ?? [])
        : []),
    ];
    for (const value of ids) if (typeof value === "string") found.add(value);
    for (const child of node.children ?? []) visit(child);
  }
  visit(id);
  return [...found];
}

function CitedText({
  text,
  sourceIds = [],
  anchor,
}: {
  text: string;
  sourceIds?: string[];
  anchor?: Anchor;
}) {
  const { bundle, evidenceSources, explore } = useContext(View);
  const valid = sourceIds.filter((id) =>
    sourceFor(id, bundle, evidenceSources),
  );
  if (!valid.length) return <>{text}</>;
  // Only explicitly attributed text receives the source highlight.
  return (
    <>
      {anchor ? (
        <span className="gen-fact-wrap">
          <button
            type="button"
            className="gen-fact-link"
            onClick={() => explore(anchor)}
          >
            <mark className="gen-fact">{text}</mark>
          </button>
          <FactPreview sourceId={valid[0]!} />
        </span>
      ) : (
        text
      )}
      {valid.map((id) => (
        <SourceLink key={id} sourceId={id} superscript />
      ))}
    </>
  );
}

function FactPreview({
  sourceId,
  preview,
  seriesRef,
}: {
  sourceId: string;
  preview?: string;
  seriesRef?: string;
}) {
  const { bundle, evidenceSources } = useContext(View);
  const series = seriesRef
    ? bundle?.story.series[seriesRef]
    : Object.values(bundle?.story.series ?? {}).find(
        (item) => item.sourceId === sourceId,
      );
  const points =
    series?.points
      .filter((point) => Number.isFinite(point.value))
      .sort((a, b) => a.date.localeCompare(b.date)) ?? [];
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const source = sourceFor(sourceId, bundle, evidenceSources);
  return (
    <span className="gen-fact-preview" role="note">
      {points.length > 1 ? (
        <>
          <span className="eyebrow">{series?.label}</span>
          <svg
            viewBox="0 0 210 88"
            role="img"
            aria-label={`${series?.label} trend preview`}
          >
            <line x1="34" y1="8" x2="34" y2="62" className="gen-axis" />
            <line x1="34" y1="62" x2="204" y2="62" className="gen-axis" />
            <text x="30" y="12" textAnchor="end">
              {series?.unit === "USD" ? "$" : ""}
              {formatCents(max)}
            </text>
            <text x="30" y="62" textAnchor="end">
              {series?.unit === "USD" ? "$" : ""}
              {formatCents(min)}
            </text>
            <text x="34" y="80">
              {points[0]?.date}
            </text>
            <text x="204" y="80" textAnchor="end">
              {points.at(-1)?.date}
            </text>
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              points={points
                .map(
                  (point, index) =>
                    `${34 + (index / (points.length - 1)) * 170},${58 - ((point.value - min) / range) * 46}`,
                )
                .join(" ")}
            />
          </svg>
        </>
      ) : (
        <span>
          {preview ??
            source?.excerpt ??
            source?.text ??
            source?.label ??
            "Sourced detail"}
        </span>
      )}
    </span>
  );
}

function EmptyData() {
  return <p className="gen-empty">No sourced data available for this view.</p>;
}
function SourceLink({
  sourceId,
  superscript = false,
}: {
  sourceId: string;
  superscript?: boolean;
}) {
  const { bundle, evidenceSources, sourceNumbers } = useContext(View);
  const source = sourceFor(sourceId, bundle, evidenceSources);
  return source ? (
    <a
      className={superscript ? "gen-citation" : "gen-source"}
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Source ${sourceNumbers[sourceId] ?? ""}: ${source.label} (opens in new tab)`}
      title={source.label}
    >
      {superscript ? (
        <sup>[{sourceNumbers[sourceId]}]</sup>
      ) : (
        `[${sourceNumbers[sourceId]}] ${source.label} ↗`
      )}
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
      <strong>
        <CitedText text={metric.display} sourceIds={[metric.sourceId]} />
      </strong>
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
  const { bundle, explore } = useContext(View);
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
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = (rawMax - rawMin) * 0.12 || Math.abs(rawMax) * 0.01 || 1;
  const min = mode === "line" ? rawMin - padding : Math.min(0, rawMin);
  const max = mode === "line" ? rawMax + padding : Math.max(0, rawMax);
  const range = max - min;
  const dates = [
    ...new Set(series.flatMap(({ data }) => data.points.map((p) => p.date))),
  ].sort();
  const x = (date: string) =>
    74 + (dates.indexOf(date) / Math.max(1, dates.length - 1)) * 518;
  const y = (value: number) => 158 - ((value - min) / range) * 118;
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
        {[0, 1, 2, 3].map((step) => {
          const value = max - (range * step) / 3;
          const yPos = 40 + step * 39;
          return (
            <g key={step}>
              <line
                x1="66"
                x2="592"
                y1={yPos}
                y2={yPos}
                className="gen-gridline"
              />
              <text
                x="58"
                y={yPos + 4}
                textAnchor="end"
                className="gen-axis-label"
              >
                {Math.abs(value) >= 1000
                  ? `${(value / 1000).toFixed(1)}k`
                  : formatCents(value)}
              </text>
            </g>
          );
        })}
        <line x1="66" x2="66" y1="40" y2="158" className="gen-axis" />
        <line x1="66" x2="592" y1="158" y2="158" className="gen-axis" />
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
                      explore({
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
                        explore({
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
                      explore({
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
                        explore({
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
        <text x="66" y="184">
          {dates[0]}
        </text>
        <text x="592" y="184" textAnchor="end">
          {dates[dates.length - 1]}
        </text>
      </svg>
      <div className="gen-legend">
        {series.map(({ ref, data }, index) => (
          <span key={ref}>
            <i className={`gen-legend-mark gen-bar-${index % 4}`} />
            {data.label}{" "}
            {data.unit &&
            data.label
              .toLowerCase()
              .includes(data.unit.toLowerCase()) ? null : (
              <small>{data.unit}</small>
            )}
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

function HorizontalBarChart({
  refs,
  title,
}: {
  refs: string[];
  title?: string;
}) {
  const { bundle } = useContext(View);
  const items = refs.flatMap((ref) => {
    const series = bundle?.story.series[ref];
    const point = series?.points
      .filter((entry) => Number.isFinite(entry.value))
      .at(-1);
    return series && point ? [{ ref, series, point }] : [];
  });
  if (!items.length) return <EmptyData />;
  const max = Math.max(...items.map(({ point }) => Math.abs(point.value)), 1);
  return (
    <figure className="gen-chart gen-horizontal-chart">
      <figcaption>{title ?? "Latest values"}</figcaption>
      <ol>
        {items.map(({ ref, series, point }, index) => (
          <li key={ref}>
            <div className="gen-horizontal-label">
              <span>{series.label}</span>
              <strong>
                {formatCents(point.value)} <small>{series.unit}</small>
              </strong>
            </div>
            <div className="gen-horizontal-track" aria-hidden="true">
              <span
                className={`gen-bar-${index % 4}`}
                style={{
                  width: `${Math.max(2, (Math.abs(point.value) / max) * 100)}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ol>
      <div className="gen-chart-sources">
        {[...new Set(items.map(({ series }) => series.sourceId))].map((id) => (
          <SourceLink key={id} sourceId={id} />
        ))}
      </div>
    </figure>
  );
}

function PieChart({ refs, title }: { refs: string[]; title?: string }) {
  const { bundle } = useContext(View);
  const items = refs.flatMap((ref) => {
    const series = bundle?.story.series[ref];
    const point = series?.points
      .filter((entry) => Number.isFinite(entry.value) && entry.value >= 0)
      .at(-1);
    return series && point && point.value > 0 ? [{ ref, series, point }] : [];
  });
  if (items.length < 2) return <EmptyData />;
  const total = items.reduce((sum, item) => sum + item.point.value, 0);
  const colors = [
    "#275d50",
    "#d49b55",
    "#829b8d",
    "#c56b52",
    "#8293a0",
    "#b8a16a",
    "#6c6c65",
    "#b47d7a",
  ];
  let cursor = 0;
  const gradient = items
    .map((item, index) => {
      const start = cursor;
      cursor += (item.point.value / total) * 100;
      return `${colors[index % colors.length]} ${start}% ${cursor}%`;
    })
    .join(", ");
  return (
    <figure className="gen-chart gen-pie-chart">
      <figcaption>{title ?? "Latest-value composition"}</figcaption>
      <div className="gen-pie-layout">
        <div
          className="gen-pie"
          style={{ background: `conic-gradient(${gradient})` }}
          role="img"
          aria-label={`Composition chart: ${items.map(({ series, point }) => `${series.label} ${((point.value / total) * 100).toFixed(1)} percent`).join(", ")}`}
        >
          <span>
            <strong>{items.length}</strong>
            <small>series</small>
          </span>
        </div>
        <ul className="gen-pie-legend">
          {items.map(({ ref, series, point }, index) => (
            <li key={ref}>
              <i style={{ background: colors[index % colors.length] }} />
              <span>{series.label}</span>
              <strong>{((point.value / total) * 100).toFixed(1)}%</strong>
              <small>
                {formatCents(point.value)} {series.unit}
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div className="gen-chart-sources">
        {[...new Set(items.map(({ series }) => series.sourceId))].map((id) => (
          <SourceLink key={id} sourceId={id} />
        ))}
      </div>
    </figure>
  );
}

function MarketChart({
  assetKey,
  range,
  title,
}: {
  assetKey: string;
  range: "1w" | "1mo" | "3mo" | "1y";
  title?: string;
}) {
  const { portfolioId, storyId, registerSource } = useContext(View);
  const registerSourceRef = useRef(registerSource);
  registerSourceRef.current = registerSource;
  const [series, setSeries] = useState<Series | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const sourceId = marketSourceId(assetKey, range);

  useEffect(() => {
    const controller = new AbortController();
    setSeries(null);
    setError("");
    setStale(false);
    const query = new URLSearchParams({
      portfolioId: String(portfolioId),
      storyId: String(storyId),
      assetKey,
      range,
    });
    void fetch(`/api/market-series?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "No imported daily prices for this holding and range."
              : "Imported historical prices are unavailable right now.",
          );
        const payload: unknown = await response.json();
        if (
          !payload ||
          typeof payload !== "object" ||
          !("series" in payload) ||
          !("source" in payload) ||
          !("assetKey" in payload) ||
          payload.assetKey !== assetKey ||
          !("range" in payload) ||
          payload.range !== range
        )
          throw new Error("Historical price response is invalid.");
        const data = payload.series;
        const source = payload.source;
        if (
          !data ||
          typeof data !== "object" ||
          !("sourceId" in data) ||
          data.sourceId !== sourceId ||
          !("points" in data) ||
          !Array.isArray(data.points) ||
          !("label" in data) ||
          typeof data.label !== "string" ||
          !("unit" in data) ||
          typeof data.unit !== "string" ||
          !source ||
          typeof source !== "object" ||
          !("label" in source) ||
          typeof source.label !== "string" ||
          !("url" in source) ||
          typeof source.url !== "string" ||
          !sourceFor(sourceId, null, {
            [sourceId]: { label: source.label, url: source.url },
          })
        )
          throw new Error("Historical price response is invalid.");
        const points: Series["points"] = data.points.filter(
          (point: unknown): point is Series["points"][number] =>
            !!point &&
            typeof point === "object" &&
            "date" in point &&
            typeof point.date === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(point.date) &&
            "value" in point &&
            typeof point.value === "number" &&
            Number.isFinite(point.value),
        );
        if (points.length < 2)
          throw new Error("Not enough historical prices for a chart.");
        if (controller.signal.aborted) return;
        registerSourceRef.current(sourceId, {
          label: source.label,
          url: source.url,
        });
        setSeries({ label: data.label, unit: data.unit, points, sourceId });
        setStale("stale" in payload && payload.stale === true);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Historical prices are unavailable.",
          );
      });
    return () => controller.abort();
  }, [portfolioId, storyId, assetKey, range, sourceId]);

  if (error)
    return (
      <p className="gen-empty" role="status">
        {error}
      </p>
    );
  if (!series)
    return (
      <div className="chart-skeleton" role="status" aria-label="Loading chart">
        <Skeleton className="skeleton-line skeleton-line-short" />
        <Skeleton className="skeleton-chart" />
      </div>
    );
  const values = series.points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const first = series.points[0]!;
  const last = series.points[series.points.length - 1]!;
  const change = first.value > 0 ? (last.value / first.value - 1) * 100 : null;
  const rising = last.value >= first.value;
  const chartColor = rising ? "#287a5b" : "#b64b43";
  const coordinates = series.points.map((point, index) => ({
    x: 64 + (index / (series.points.length - 1)) * 568,
    y: 164 - ((point.value - min) / span) * 122,
  }));
  const linePoints = coordinates.map(({ x, y }) => `${x},${y}`).join(" ");
  const areaPath = `M ${coordinates[0]!.x},174 L ${linePoints.replaceAll(
    " ",
    " L ",
  )} L ${coordinates.at(-1)!.x},174 Z`;
  const gradientId = `market-fill-${assetKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <figure className="gen-chart gen-market-chart">
      <header className="gen-market-heading">
        <div>
          <span className="eyebrow">{title ?? series.label}</span>
          <strong className="gen-market-price">
            ${formatCents(last.value)}
          </strong>
          <span className="gen-market-caption">Latest close · {last.date}</span>
        </div>
        <div className="gen-market-summary">
          {change !== null && (
            <span
              className={`gen-market-change${rising ? "is-up" : "is-down"}`}
            >
              <span aria-hidden="true">{rising ? "↗" : "↘"}</span>{" "}
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}%
            </span>
          )}
          <span className="gen-market-period">
            {first.date} — {last.date}
          </span>
          {stale && <span className="gen-market-stale">Delayed data</span>}
        </div>
      </header>
      <svg
        className="gen-market-plot"
        viewBox="0 0 660 220"
        role="img"
        aria-label={`${series.label}, ${first.date} to ${last.date}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={chartColor} stopOpacity=".2" />
            <stop offset="100%" stopColor={chartColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[38, 78, 118, 158].map((y, index) => {
          const value = max - ((max - min) * index) / 3;
          return (
            <g key={y}>
              <line
                x1="70"
                y1={y}
                x2="638"
                y2={y}
                className="gen-market-gridline"
              />
              <text x="62" y={y + 4} textAnchor="end">
                ${formatCents(value)}
              </text>
            </g>
          );
        })}
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <polyline
          fill="none"
          stroke={chartColor}
          strokeWidth="2.5"
          points={linePoints}
        />
        <circle
          cx={coordinates.at(-1)!.x}
          cy={coordinates.at(-1)!.y}
          r="4"
          fill={chartColor}
        />
        <text x="70" y="202">
          {first.date}
        </text>
        <text x="638" y="202" textAnchor="end">
          {last.date}
        </text>
      </svg>
      <div className="gen-market-footer">
        <span>{series.points.length} trading sessions</span>
        <SourceLink sourceId={sourceId} />
      </div>
    </figure>
  );
}

const { registry: baseRegistry } = defineRegistry(catalog, {
  components: {
    Deck: ({ props, children }) => {
      const slides = Children.toArray(children);
      const spec = useContext(View).spec;
      const root = spec?.elements[spec.root];
      return (
        <article className="gen-deck" aria-label={props.title}>
          <div className="gen-deck-header">
            <span className="eyebrow">IN THIS ARTICLE</span>
            {slides.length ? (
              <nav aria-label="Article topics" className="gen-article-toc">
                {slides.map((_, index) => {
                  const pageId = root?.children?.[index];
                  const page = pageId ? spec?.elements[pageId] : undefined;
                  const title =
                    typeof page?.props.title === "string"
                      ? page.props.title
                      : `Topic ${index + 1}`;
                  return (
                    <a key={index} href={`#article-topic-${index}`}>
                      {title}
                    </a>
                  );
                })}
              </nav>
            ) : (
              <span className="eyebrow">GENERATING</span>
            )}
          </div>
          {slides.length ? (
            <div className="gen-article-body">
              {slides.map((slide, index) => (
                <div
                  className="gen-article-topic"
                  id={`article-topic-${index}`}
                  key={index}
                >
                  {slide}
                </div>
              ))}
            </div>
          ) : (
            <div
              className="briefing-skeleton"
              role="status"
              aria-label="Preparing briefing"
            >
              <Skeleton className="skeleton-line skeleton-line-short" />
              <Skeleton className="skeleton-title" />
              <Skeleton className="skeleton-paragraph" />
              <Skeleton className="skeleton-paragraph skeleton-paragraph-short" />
            </div>
          )}
        </article>
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
    Section: ({ props, children }) => (
      <section className="gen-section">
        <h3>{props.title}</h3>
        {children}
      </section>
    ),
    Accordion: ({ props, children }) => (
      <details className="gen-accordion" open={props.expanded ?? false}>
        <summary>{props.title}</summary>
        <div className="gen-accordion-content">{children}</div>
      </details>
    ),
    StorySlide: ({ props, children }) => (
      <section className="gen-slide">
        <p className="eyebrow">{props.kicker}</p>
        <h2>{props.title}</h2>
        <div className="gen-evidence">{children}</div>
      </section>
    ),
    Summary: ({ props }) => (
      <details className="gen-summary" open={!props.expandedText}>
        <summary>
          <CitedText text={props.text} sourceIds={props.sourceIds} />
        </summary>
        {props.expandedText && (
          <p>
            <CitedText text={props.expandedText} sourceIds={props.sourceIds} />
          </p>
        )}
      </details>
    ),
    HighlightFact: ({ props }) => {
      const { bundle, evidenceSources, explore } = useContext(View);
      if (
        !sourceFor(props.sourceId, bundle, evidenceSources) ||
        !props.preview.trim() ||
        !props.highlight.trim() ||
        !props.text.includes(props.highlight)
      )
        return <p>{props.text}</p>;
      const index = props.text.indexOf(props.highlight);
      return (
        <p className="gen-highlight-fact">
          {props.text.slice(0, index)}
          <span className="gen-fact-wrap">
            <button
              type="button"
              className="gen-fact-link"
              onClick={() =>
                explore({ elementType: "HighlightFact", elementProps: props })
              }
            >
              <mark className="gen-fact">{props.highlight}</mark>
            </button>
            <FactPreview sourceId={props.sourceId} preview={props.preview} />
          </span>
          {props.text.slice(index + props.highlight.length)}
          <SourceLink sourceId={props.sourceId} superscript />
        </p>
      );
    },
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
    MetricsTable: ({ props }) => {
      const bundle = useContext(View).bundle;
      const metrics = props.metricRefs
        .map((ref) => ({ ref, metric: bundle?.story.metrics[ref] }))
        .filter(
          (entry): entry is { ref: string; metric: Metric } => !!entry.metric,
        );
      if (!metrics.length) return <EmptyData />;
      return (
        <div
          className="gen-table-wrap"
          role="region"
          aria-label={props.title ?? "Sourced metrics"}
          tabIndex={0}
        >
          <table className="gen-table">
            <caption>{props.title ?? "Sourced metrics"}</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(({ ref, metric }) => (
                <tr key={ref}>
                  <th scope="row">{metric.label}</th>
                  <td>
                    <strong>{metric.display}</strong>
                    <SourceLink sourceId={metric.sourceId} superscript />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    },
    LineChart: ({ props }) => (
      <Chart refs={props.seriesRefs} title={props.title} mode="line" />
    ),
    MarketChart: ({ props }) => <MarketChart {...props} />,
    BarChart: ({ props }) => (
      <Chart refs={props.seriesRefs} title={props.title} mode="bar" />
    ),
    HorizontalBarChart: ({ props }) => (
      <HorizontalBarChart refs={props.seriesRefs} title={props.title} />
    ),
    PieChart: ({ props }) => (
      <PieChart refs={props.seriesRefs} title={props.title} />
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
          <li key={i}>
            <CitedText text={item} sourceIds={props.sourceIds} />
          </li>
        ))}
      </ul>
    ),
    RiskFlag: ({ props }) => (
      <aside className="gen-note">
        <span className="eyebrow">{props.severity} / RISK TO WATCH</span>
        <p>
          <CitedText text={props.text} sourceIds={props.sourceIds} />
        </p>
      </aside>
    ),
    Callout: ({ props }) => (
      <aside className="gen-note">
        <CitedText text={props.text} sourceIds={props.sourceIds} />
      </aside>
    ),
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
  const { ask, explore, spec, bundle, evidenceSources } = useContext(View);
  const columns = useContext(DashboardColumns);
  const [prompting, setPrompting] = useState(false);
  const [question, setQuestion] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const entry = Object.entries(spec?.elements ?? {}).find(
    ([, candidate]) =>
      candidate === element ||
      (candidate.type === element.type &&
        JSON.stringify(candidate.props) === JSON.stringify(element.props) &&
        JSON.stringify(candidate.children) ===
          JSON.stringify(element.children)),
  );
  const anchor: Anchor = {
    elementId: entry?.[0],
    elementType: element.type,
    elementProps: element.props,
  };
  const page = element.type === "StorySlide" || element.type === "Section";
  const ids =
    page && entry && spec ? referencedSources(spec, entry[0], bundle) : [];
  const primaryId = ids.find((id) => sourceFor(id, bundle, evidenceSources));
  const props = element.props;
  const span = typeof props.span === "number" ? props.span : 1;
  const seriesRef = Array.isArray(props.seriesRefs)
    ? String(props.seriesRefs[0])
    : undefined;
  const metricRef =
    typeof props.metricRef === "string" ? props.metricRef : undefined;
  const previewId =
    primaryId ??
    (metricRef ? bundle?.story.metrics[metricRef]?.sourceId : undefined);
  const submitQuestion = (text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    ask(prompt, {
      ...anchor,
      selectedText: window.getSelection()?.toString().trim() ?? undefined,
      userPrompt: prompt,
    });
    setPrompting(false);
    setQuestion("");
  };
  return (
    <div
      className={`gen-anchor${page ? "gen-page" : ""}`}
      style={
        element.type === "Section"
          ? {
              gridColumn: `span ${Math.min(12, (12 / columns) * Math.min(columns, span))}`,
            }
          : undefined
      }
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button,a,input,textarea"))
          return;
        setActionsOpen((open) => !open);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setActionsOpen((open) => !open);
        }
      }}
      tabIndex={0}
    >
      {children}
      <div
        className={`gen-anchor-actions${actionsOpen ? "is-open" : ""}${prompting ? "is-prompting" : ""}`}
        aria-hidden={!actionsOpen}
      >
        <span className="gen-explore-wrap">
          <button
            type="button"
            className="gen-anchor-trigger"
            onClick={() => explore(anchor)}
          >
            Explore ↗
          </button>
          {previewId && (
            <FactPreview sourceId={previewId} seriesRef={seriesRef} />
          )}
        </span>
        <button
          type="button"
          className="gen-anchor-trigger"
          onClick={() => setPrompting((value) => !value)}
          aria-expanded={prompting}
          aria-controls={
            prompting ? `ask-${entry?.[0] ?? "section"}` : undefined
          }
        >
          Ask
        </button>
      </div>
      {prompting && (
        <form
          id={`ask-${entry?.[0] ?? "section"}`}
          className="gen-anchor-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitQuestion(question);
          }}
        >
          <div className="gen-ask-presets" aria-label="Suggested questions">
            {[
              "What does this mean?",
              "Make me a visual",
              "Find related information",
            ].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => submitQuestion(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
          <label className="gen-anchor-question">
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
      name === "Deck" ? (
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
  storyTitle,
  question,
  scope,
  onClose,
}: {
  portfolioId: number;
  storyId: number;
  storyTitle: string;
  question: string;
  scope: "story" | "portfolio";
  onClose: () => void;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [evidenceSources, setEvidenceSources] = useState<
    Record<string, Source>
  >({});
  const [evidenceMode, setEvidenceMode] = useState("");
  const [seedToken, setSeedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingKind, setLoadingKind] = useState<
    "initial" | "explore" | "expand" | null
  >(null);
  const [error, setError] = useState("");
  const [retryRequest, setRetryRequest] = useState<{
    question: string;
    anchor?: Anchor;
    kind: "initial" | "explore";
  } | null>(null);
  const [pageTitle, setPageTitle] = useState(storyTitle);
  const [history, setHistory] = useState<
    {
      spec: Spec;
      bundle: Bundle | null;
      evidenceSources: Record<string, Source>;
      evidenceMode: string;
      title: string;
      seedToken: string | null;
    }[]
  >([]);
  const abort = useRef<AbortController | null>(null);
  const numberedSources = useRef<Record<string, number>>({});
  const currentPageIndex = useRef(0);

  async function generate(
    nextQuestion: string,
    anchor?: Anchor,
    kind: "initial" | "explore" | "expand" = "explore",
    mode: "jev" | "llm" = "llm",
  ) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const previous = spec && {
      spec,
      bundle,
      evidenceSources,
      evidenceMode,
      title: pageTitle,
      seedToken,
    };
    let committed = false;
    if (kind === "initial") {
      numberedSources.current = {};
      currentPageIndex.current = 0;
      setSpec(null);
      setBundle(null);
      setEvidenceSources({});
      setEvidenceMode("");
      setSeedToken(null);
      setHistory([]);
      setPageTitle(kind === "initial" ? storyTitle : nextQuestion);
    } else if (kind === "explore") {
      if (previous) setHistory((items) => [...items, previous]);
      currentPageIndex.current = 0;
      setSpec(null);
      setEvidenceSources({});
      setEvidenceMode("");
      setSeedToken(null);
      setPageTitle(nextQuestion);
    }
    setError("");
    setRetryRequest(null);
    setLoading(true);
    setLoadingKind(kind);
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
        if (!controller.signal.aborted && (kind === "initial" || !bundle))
          setBundle(data);
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
          scope,
          question: nextQuestion,
          mode,
          ...(nextQuestion.trim().toLowerCase() === "make me a visual"
            ? { intent: "visual" }
            : {}),
          ...(kind === "expand" && spec && seedToken
            ? { initialSpec: spec, seedToken }
            : {}),
          ...(anchor ? { anchor } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const failure: unknown = await response.json().catch(() => null);
        const message =
          failure &&
          typeof failure === "object" &&
          "error" in failure &&
          typeof failure.error === "string"
            ? failure.error
            : "Unable to generate the briefing.";
        throw new Error(message);
      }
      const encodedSources = response.headers.get("X-Evidence-Sources");
      let nextSources: Record<string, Source> = {};
      if (encodedSources) {
        try {
          const sources: unknown = JSON.parse(
            decodeURIComponent(encodedSources),
          );
          if (sources && typeof sources === "object" && !Array.isArray(sources))
            nextSources = sources as Record<string, Source>;
        } catch {
          // The view can still render its story's own sources.
        }
      }
      const nextEvidenceMode = response.headers.get("X-Evidence-Mode") ?? "";
      const compiler = createSpecStreamCompiler<Spec>({
        root: "",
        elements: {},
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let received = false;
      let stopReason = "";
      const update = (next: Spec, token?: string) => {
        if (
          !next.root ||
          !next.elements?.[next.root] ||
          controller.signal.aborted
        )
          return;
        received = true;
        if (!committed) {
          committed = true;
          if (kind !== "expand") {
            currentPageIndex.current = 0;
            setPageTitle(kind === "initial" ? storyTitle : nextQuestion);
          }
        }
        setEvidenceSources(
          kind === "expand"
            ? { ...evidenceSources, ...nextSources }
            : nextSources,
        );
        setEvidenceMode(nextEvidenceMode);
        setSeedToken(token ?? null);
        setSpec({ ...next, elements: { ...next.elements } });
      };
      const consume = (line: string) => {
        if (!line.trim()) return;
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          throw new Error("Invalid briefing stream.");
        }
        if (frame && typeof frame === "object" && "type" in frame) {
          if (
            frame.type === "spec" &&
            "spec" in frame &&
            frame.spec &&
            typeof frame.spec === "object"
          )
            update(
              frame.spec as Spec,
              "seedToken" in frame && typeof frame.seedToken === "string"
                ? frame.seedToken
                : undefined,
            );
          if (frame.type === "complete" && "stopReason" in frame)
            stopReason = String(frame.stopReason);
        } else {
          const { result, newPatches } = compiler.push(`${line}\n`);
          if (newPatches.length) update(result);
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        let end: number;
        while ((end = pending.indexOf("\n")) !== -1) {
          consume(pending.slice(0, end));
          pending = pending.slice(end + 1);
        }
        if (done) {
          if (pending.trim()) consume(pending);
          break;
        }
      }
      if (!received) throw new Error("No briefing was generated.");
      if (stopReason && stopReason !== "finish")
        setError(
          `Briefing incomplete (${stopReason}). Last sourced view retained.`,
        );
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (mode === "jev" && kind !== "expand")
          setRetryRequest({ question: nextQuestion, anchor, kind });
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to generate the briefing.",
        );
      }
    } finally {
      await dataRequest;
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingKind(null);
      }
    }
  }

  const generateRef = useRef(generate);
  generateRef.current = generate;
  useEffect(() => {
    void generateRef.current(question, undefined, "initial");
    return () => abort.current?.abort();
  }, [portfolioId, storyId, question, scope]);
  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement;
    document.body.style.overflow = "hidden";
    overlay.current?.focus();
    return () => {
      document.body.style.overflow = "";
      returnFocus.current?.focus();
    };
  }, []);
  function goBack() {
    abort.current?.abort();
    currentPageIndex.current = 0;
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setSpec(previous.spec);
    setBundle(previous.bundle);
    setEvidenceSources(previous.evidenceSources);
    setEvidenceMode(previous.evidenceMode);
    setSeedToken(previous.seedToken);
    setPageTitle(previous.title);
    setError("");
    setLoading(false);
    setLoadingKind(null);
  }
  function goTo(index: number) {
    abort.current?.abort();
    currentPageIndex.current = 0;
    const page = history[index];
    if (!page) return;
    setHistory((items) => items.slice(0, index));
    setSpec(page.spec);
    setBundle(page.bundle);
    setEvidenceSources(page.evidenceSources);
    setEvidenceMode(page.evidenceMode);
    setSeedToken(page.seedToken);
    setPageTitle(page.title);
    setError("");
    setLoading(false);
    setLoadingKind(null);
  }
  for (const id of spec ? referencedSources(spec, spec.root, bundle) : []) {
    if (sourceFor(id, bundle, evidenceSources) && !numberedSources.current[id])
      numberedSources.current[id] =
        Object.keys(numberedSources.current).length + 1;
  }
  const sourceNumbers = numberedSources.current;
  const explore = (anchor: Anchor) => {
    const props = anchor.elementProps;
    const label = [
      props.title,
      props.label,
      props.text,
      props.metricRef,
      props.date,
    ].find((item): item is string => typeof item === "string" && !!item.trim());
    void generate(
      `Explore ${label ?? anchor.elementType} in depth using the cited evidence`.slice(
        0,
        500,
      ),
      anchor,
    );
  };
  return (
    <div
      ref={overlay}
      className="gen-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Generated portfolio briefing"
      aria-labelledby="gen-page-title"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
        if (event.key === "Tab") {
          const items = overlay.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]',
          );
          if (!items?.length) return;
          const first = items[0]!;
          const last = items[items.length - 1]!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <div className="gen-toolbar">
        <Brand />
        <nav aria-label="Briefing navigation">
          <button onClick={history.length ? goBack : onClose}>
            {history.length ? `← Back (${history.length})` : "← Feed"}
          </button>
          <span className="eyebrow">
            {evidenceMode
              ? `EVIDENCE / ${evidenceMode.toUpperCase()}`
              : history.length
                ? "FOLLOW-UP RESEARCH"
                : "PERSONAL DEEP DIVE"}
          </span>
        </nav>
        <button onClick={onClose} aria-label="Close briefing">
          Close ×
        </button>
      </div>
      <div className="gen-content" aria-live="polite">
        <header className="gen-subpage-header">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  onClick={() => (history.length ? goTo(0) : undefined)}
                  disabled={!history.length}
                >
                  Briefing
                </BreadcrumbLink>
              </BreadcrumbItem>
              {history.map((page, index) => (
                <BreadcrumbItem key={`${index}-${page.title}`}>
                  <BreadcrumbSeparator />
                  <BreadcrumbLink onClick={() => goTo(index)}>
                    {page.title}
                  </BreadcrumbLink>
                </BreadcrumbItem>
              ))}
              <BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <p className="eyebrow">
            {history.length
              ? "FOCUSED EXPLORATION"
              : scope === "portfolio"
                ? "PORTFOLIO RESEARCH"
                : "SOURCED BRIEFING"}{" "}
            {evidenceMode && `/ ${evidenceMode.toUpperCase()}`}
          </p>
          <h1 id="gen-page-title">{pageTitle}</h1>
          {scope === "portfolio" && (
            <p className="gen-question">Question: {question}</p>
          )}
        </header>
        {spec && (
          <View.Provider
            value={{
              bundle,
              evidenceSources,
              spec,
              portfolioId,
              storyId,
              registerSource: (id, source) => {
                setEvidenceSources((current) => ({ ...current, [id]: source }));
              },
              ask: (text, anchor) => {
                if (!loading) void generate(text, anchor);
              },
              explore: (anchor) => {
                if (!loading) explore(anchor);
              },
              sourceNumbers,
              setPageIndex: (index) => {
                currentPageIndex.current = index;
              },
            }}
          >
            <JSONUIProvider
              key={`${storyId}-${history.length}-${bundle ? "loaded" : "empty"}`}
              registry={registry}
              initialState={bundle ?? {}}
            >
              <Renderer spec={spec} registry={registry} />
            </JSONUIProvider>
          </View.Provider>
        )}
        {loading &&
          (spec && loadingKind === "expand" ? (
            <div
              className="expansion-skeleton"
              role="status"
              aria-label="Expanding briefing"
            >
              <Skeleton className="skeleton-line skeleton-line-short" />
              <Skeleton className="skeleton-line" />
              <Skeleton className="skeleton-paragraph" />
              <Skeleton className="skeleton-paragraph skeleton-paragraph-short" />
            </div>
          ) : (
            <div
              className="briefing-skeleton"
              role="status"
              aria-label="Preparing briefing"
            >
              <Skeleton className="skeleton-line skeleton-line-short" />
              <Skeleton className="skeleton-title" />
              <Skeleton className="skeleton-paragraph" />
              <Skeleton className="skeleton-paragraph skeleton-paragraph-short" />
              <Skeleton className="skeleton-card" />
            </div>
          ))}
        {error && (
          <div className="gen-status error" role="alert">
            <p>{error}</p>
            {retryRequest && (
              <button
                type="button"
                className="gen-retry"
                onClick={() =>
                  void generate(
                    retryRequest.question,
                    retryRequest.anchor,
                    retryRequest.kind,
                    "llm",
                  )
                }
              >
                Try legacy model ↗
              </button>
            )}
          </div>
        )}
        {!loading && !spec && !error && <EmptyData />}
      </div>
    </div>
  );
}
