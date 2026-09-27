"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleUserRound } from "lucide-react";

import { Brand } from "~/app/_components/brand";
import { Skeleton } from "~/components/ui/skeleton";
import { GenerativeView } from "~/app/_components/generative-view";
import { api, type RouterOutputs } from "~/trpc/react";

type Portfolio = RouterOutputs["portfolio"]["list"][number];
type Holding = Portfolio["holdings"][number];
type Story = RouterOutputs["portfolio"]["stories"][number];

function StorySummary({ story }: { story: Story }) {
  const [expanded, setExpanded] = useState(false);
  const summary = story.summary.trim();
  const clipped = summary.length > 240;
  const preview = clipped
    ? summary
        .slice(0, 240)
        .replace(/\s+\S*$/, "")
        .trimEnd()
    : summary;
  const fullText = story.content.trim().startsWith(summary)
    ? story.content.trim()
    : `${summary}\n\n${story.content.trim()}`.trim();
  const canExpand = fullText.length > preview.length;

  return (
    <p>
      {expanded ? fullText : preview}
      {!expanded && canExpand && !preview.endsWith("…") && "…"}{" "}
      {canExpand && (
        <button
          type="button"
          className="story-read-more"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </p>
  );
}

function StoryExploreButton({
  story,
  onExplore,
}: {
  story: Story;
  onExplore: (focus: string) => void;
}) {
  return (
    <button
      className="deep-button"
      onClick={() =>
        onExplore(
          `Explain ${story.title}. Show the relevant chart if sourced data exists.`,
        )
      }
    >
      Explore ↗
    </button>
  );
}

export function Dashboard({ userName }: { userName: string }) {
  const utils = api.useUtils();
  const {
    data: portfolios = [],
    isLoading,
    error: listError,
  } = api.portfolio.list.useQuery();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const active =
    portfolios.find((portfolio) => portfolio.id === selectedId) ??
    portfolios[0];
  const { data: stories = [], isLoading: storiesLoading } =
    api.portfolio.stories.useQuery(
      { portfolioId: active?.id ?? 0 },
      { enabled: !!active },
    );
  const feedStories = stories.filter(
    (story, index) =>
      stories.findIndex(
        (candidate) =>
          candidate.title.trim().toLowerCase() ===
          story.title.trim().toLowerCase(),
      ) === index,
  );
  const [editing, setEditing] = useState<Portfolio | "new" | null>(null);
  const [name, setName] = useState("");
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [kind, setKind] = useState<Holding["kind"]>("stock");
  const [symbol, setSymbol] = useState("");
  const [formError, setFormError] = useState("");
  const [view, setView] = useState<{
    storyId: number;
    question: string;
    scope: "story" | "portfolio";
  } | null>(null);
  const [globalQuestion, setGlobalQuestion] = useState("");
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const editorClose = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const portfolio = Number(params.get("portfolio"));
    const story = Number(params.get("story"));
    if (Number.isInteger(portfolio) && portfolio > 0) setSelectedId(portfolio);
    if (Number.isInteger(story) && story > 0) {
      setView({ storyId: story, question: "", scope: "story" });
    }
    const restore = () => {
      const current = new URLSearchParams(window.location.search);
      const portfolioId = Number(current.get("portfolio"));
      const storyId = Number(current.get("story"));
      setSelectedId(
        Number.isInteger(portfolioId) && portfolioId > 0 ? portfolioId : null,
      );
      setView(
        Number.isInteger(storyId) && storyId > 0
          ? { storyId, question: "", scope: "story" }
          : null,
      );
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    if (!active) return;
    const params = new URLSearchParams(window.location.search);
    params.set("portfolio", String(active.id));
    if (view?.scope === "story") params.set("story", String(view.storyId));
    else params.delete("story");
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (window.location.href !== `${window.location.origin}${url}`)
      window.history.pushState(null, "", url);
  }, [active?.id, view]);

  useEffect(() => {
    if (!editing) return;
    previousFocus.current = document.activeElement as HTMLElement;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => editorClose.current?.focus());
    return () => {
      document.body.style.overflow = "";
      previousFocus.current?.focus();
    };
  }, [editing]);

  useEffect(() => {
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === "Escape") accountMenu.current?.removeAttribute("open");
    };
    const closeOutside = (event: PointerEvent) => {
      if (!accountMenu.current?.contains(event.target as Node))
        accountMenu.current?.removeAttribute("open");
    };
    document.addEventListener("keydown", closeMenu);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeMenu);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, []);

  const create = api.portfolio.create.useMutation({
    onSuccess: async () => {
      await utils.portfolio.invalidate();
      setEditing(null);
    },
  });
  const update = api.portfolio.update.useMutation({
    onSuccess: async () => {
      await utils.portfolio.invalidate();
      setEditing(null);
    },
  });
  const remove = api.portfolio.delete.useMutation({
    onSuccess: async () => {
      await utils.portfolio.invalidate();
      setSelectedId(null);
      setEditing(null);
    },
  });

  function openEditor(portfolio?: Portfolio) {
    setEditing(portfolio ?? "new");
    setName(portfolio?.name ?? "");
    setHoldings(portfolio?.holdings ?? []);
    setSymbol("");
    setFormError("");
  }

  function addHolding() {
    const normalized = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9._-]{1,32}$/.test(normalized)) {
      setFormError("Enter a valid ticker or identifier.");
      return;
    }
    if (holdings.some((h) => h.kind === kind && h.symbol === normalized)) {
      setFormError("That asset is already in this portfolio.");
      return;
    }
    setHoldings([...holdings, { kind, symbol: normalized, name: normalized }]);
    setSymbol("");
    setFormError("");
  }

  function savePortfolio() {
    if (!name.trim()) {
      setFormError("Give your portfolio a name.");
      return;
    }
    const payload = { name: name.trim(), holdings };
    if (editing === "new") create.mutate(payload);
    else if (editing) update.mutate({ ...payload, id: editing.id });
  }

  function closeEditor() {
    if (
      editing !== "new" &&
      editing &&
      (name !== editing.name ||
        JSON.stringify(holdings) !== JSON.stringify(editing.holdings)) &&
      !window.confirm("Discard unsaved portfolio changes?")
    )
      return;
    setEditing(null);
  }

  return (
    <main className="app-shell">
      <nav className="topbar">
        <Brand />
        <span className="topbar-note">PERSONAL PORTFOLIO INTELLIGENCE</span>
        <details
          ref={accountMenu}
          className="account-menu"
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              event.currentTarget.removeAttribute("open");
          }}
        >
          <summary aria-label="Open account menu">
            <CircleUserRound aria-hidden="true" />
          </summary>
          <div className="account-menu-panel">
            <button
              type="button"
              onClick={(event) => {
                openEditor();
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              Add Portfolio
            </button>
            <Link href="/api/auth/signout">Sign Out</Link>
          </div>
        </details>
      </nav>
      <div className="dashboard-layout">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span className="eyebrow">PORTFOLIO DIRECTORY</span>
            <button
              className="icon-button"
              aria-label="Create portfolio"
              onClick={() => openEditor()}
            >
              +
            </button>
          </div>
          <h2>
            Portfolios
            <span className="muted-count">
              {" "}
              {portfolios.length.toString().padStart(2, "0")}
            </span>
          </h2>
          {isLoading && (
            <div
              className="portfolio-skeleton"
              role="status"
              aria-label="Loading portfolios"
            >
              <Skeleton className="skeleton-line" />
              <Skeleton className="skeleton-line" />
              <Skeleton className="skeleton-line skeleton-line-short" />
            </div>
          )}
          {listError && <p className="error">{listError.message}</p>}
          {portfolios.map((portfolio) => (
            <button
              key={portfolio.id}
              className={`portfolio-item ${active?.id === portfolio.id ? "selected" : ""}`}
              onClick={() => {
                setSelectedId(portfolio.id);
                setView(null);
              }}
            >
              <span>{portfolio.name}</span>
              <small>
                {portfolio.holdings.length}{" "}
                {portfolio.holdings.length === 1 ? "ASSET" : "ASSETS"}
              </small>
            </button>
          ))}
          <div className="sidebar-footer">
            A clearer view of what moves your portfolio.
            <br />
            Research with perspective.
          </div>
        </aside>
        <div className="content">
          <header className="content-header">
            <span>YOUR PORTFOLIO REVIEW</span>
            <span>
              {new Date()
                .toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })
                .toUpperCase()}
            </span>
          </header>
          <section className="hero">
            <p className="eyebrow">
              PRIVATE BRIEFING / {userName.toUpperCase()}
            </p>
            <h1>
              A clearer view
              <br />
              <em>of your holdings.</em>
            </h1>
            <p>Relevant developments, with the context to go further.</p>
          </section>
          {active ? (
            <>
              <div className="section-header">
                <div>
                  <p className="eyebrow">
                    PORTFOLIO / {active.name.toUpperCase()}
                  </p>
                  <h2>Your briefing</h2>
                </div>
                <button
                  className="text-button"
                  onClick={() => openEditor(active)}
                >
                  Edit portfolio
                </button>
              </div>
              <div className="asset-strip">
                {active.holdings.map((h) => (
                  <span key={`${h.kind}:${h.symbol}`} className="asset-pill">
                    <b>{h.symbol}</b>{" "}
                    <span>{h.kind === "stock" ? "EQUITY" : "ALT"}</span>
                  </span>
                ))}
                {active.holdings.length === 0 && (
                  <span className="muted">
                    No assets yet. Edit your portfolio to add some.
                  </span>
                )}
              </div>
              <form
                className="question-form global-question"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (stories[0] && globalQuestion.trim()) {
                    setView({
                      storyId: stories[0].id,
                      question: globalQuestion.trim(),
                      scope: "portfolio",
                    });
                    setGlobalQuestion("");
                  }
                }}
              >
                <label htmlFor="global-question">
                  ASK ABOUT YOUR PORTFOLIO
                </label>
                <div>
                  <input
                    id="global-question"
                    value={globalQuestion}
                    onChange={(event) => setGlobalQuestion(event.target.value)}
                    maxLength={500}
                    placeholder="What changed across my holdings?"
                    required
                    disabled={!stories.length}
                  />
                  <button disabled={!stories.length}>Explore</button>
                </div>
                {!stories.length && (
                  <p className="muted">
                    Questions become available when sourced stories arrive.
                  </p>
                )}
              </form>
              {storiesLoading ? (
                <div
                  className="story-skeleton"
                  role="status"
                  aria-label="Loading stories"
                >
                  <Skeleton className="skeleton-line skeleton-line-short" />
                  <Skeleton className="skeleton-title" />
                  <Skeleton className="skeleton-paragraph" />
                  <Skeleton className="skeleton-paragraph skeleton-paragraph-short" />
                </div>
              ) : feedStories.length ? (
                <div className="stories">
                  {feedStories.map((story, index) => (
                    <article className="story" key={story.id}>
                      <div className="story-meta">
                        <span>STORY {String(index + 1).padStart(2, "0")}</span>
                        <span>
                          {active.holdings.find(
                            (holding) =>
                              `${holding.kind}:${holding.symbol}` ===
                              story.assetKey,
                          )?.symbol ?? story.assetKey.split(":")[1]}{" "}
                          / {story.assetKey.split(":")[1]}
                        </span>
                        <span>
                          {story.sourceName} ·{" "}
                          {new Date(story.publishedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <h3>{story.title}</h3>
                      <StorySummary story={story} />
                      <div className="story-actions">
                        <StoryExploreButton
                          story={story}
                          onExplore={(question) =>
                            setView({
                              storyId: story.id,
                              question,
                              scope: "story",
                            })
                          }
                        />
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <span className="empty-symbol" aria-hidden="true">
                    01
                  </span>
                  <h3>No stories in rotation yet.</h3>
                  <p>
                    When your data pipeline adds sourced news or filings for
                    these assets, your personalized briefing will appear here.
                  </p>
                  <span className="eyebrow">AWAITING YOUR FIRST UPDATE</span>
                </div>
              )}
            </>
          ) : (
            !isLoading && (
              <div className="empty-state">
                <span className="empty-symbol" aria-hidden="true">
                  01
                </span>
                <h3>Make it yours.</h3>
                <p>
                  Create a portfolio and add the stocks or alternative assets
                  you want to follow.
                </p>
                <button className="primary-button" onClick={() => openEditor()}>
                  Create a portfolio
                </button>
              </div>
            )
          )}
        </div>
      </div>
      {editing && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Portfolio editor"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeEditor();
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <div className="editor">
            <div className="editor-top">
              <span className="eyebrow">YOUR WATCHLIST</span>
              <button
                ref={editorClose}
                onClick={closeEditor}
                aria-label="Close editor"
              >
                ×
              </button>
            </div>
            <h2>
              {editing === "new" ? "New portfolio" : "Edit portfolio"}
              <span className="accent">.</span>
            </h2>
            <label className="field">
              Portfolio name
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                placeholder="e.g. The long view"
              />
            </label>
            <div className="field">
              <span>Holdings</span>
              <div className="holding-entry">
                <select
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value as Holding["kind"])
                  }
                >
                  <option value="stock">Stock</option>
                  <option value="alternative">Alternative</option>
                </select>
                <input
                  aria-label="Symbol"
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value)}
                  placeholder="AAPL / BTC"
                  maxLength={32}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addHolding();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={addHolding}
                  aria-label="Add holding"
                >
                  +
                </button>
              </div>
            </div>
            <div className="holding-list">
              {holdings.map((h) => (
                <div key={`${h.kind}:${h.symbol}`}>
                  <span>
                    <b>{h.symbol}</b> {h.name} <small>· {h.kind}</small>
                  </span>
                  <button
                    aria-label={`Remove ${h.symbol}`}
                    onClick={() =>
                      setHoldings(holdings.filter((item) => item !== h))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {formError && <p className="error">{formError}</p>}
            {(create.error ?? update.error ?? remove.error) && (
              <p className="error">
                {(create.error ?? update.error ?? remove.error)?.message}
              </p>
            )}
            <div className="editor-actions">
              {editing !== "new" && (
                <button
                  className="delete-button"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm("Delete this portfolio?"))
                      remove.mutate({ id: editing.id });
                  }}
                >
                  Delete portfolio
                </button>
              )}
              <button
                className="primary-button"
                disabled={create.isPending || update.isPending || !name.trim()}
                onClick={savePortfolio}
              >
                {create.isPending || update.isPending
                  ? "Saving…"
                  : "Save portfolio"}
              </button>
            </div>
          </div>
        </div>
      )}
      {view && active && (
        <GenerativeView
          key={`${active.id}:${view.storyId}:${view.question}`}
          portfolioId={active.id}
          storyId={view.storyId}
          storyTitle={
            view.scope === "portfolio"
              ? view.question
              : (stories.find((story) => story.id === view.storyId)?.title ??
                "Portfolio briefing")
          }
          question={view.question}
          scope={view.scope}
          onClose={() => setView(null)}
        />
      )}
    </main>
  );
}
