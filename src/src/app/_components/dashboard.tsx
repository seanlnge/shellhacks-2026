"use client";

import { useState } from "react";
import Link from "next/link";

import { GenerativeView } from "~/app/_components/generative-view";
import { api, type RouterOutputs } from "~/trpc/react";

type Portfolio = RouterOutputs["portfolio"]["list"][number];
type Holding = Portfolio["holdings"][number];

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
  const [editing, setEditing] = useState<Portfolio | "new" | null>(null);
  const [name, setName] = useState("");
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [kind, setKind] = useState<Holding["kind"]>("stock");
  const [symbol, setSymbol] = useState("");
  const [assetName, setAssetName] = useState("");
  const [formError, setFormError] = useState("");
  const [expandedStory, setExpandedStory] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [view, setView] = useState<{
    storyId: number;
    question: string;
  } | null>(null);
  const [globalQuestion, setGlobalQuestion] = useState("");

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
    setAssetName("");
    setFormError("");
  }

  function addHolding() {
    const normalized = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9._-]{1,32}$/.test(normalized) || !assetName.trim()) {
      setFormError("Enter an asset name and a valid ticker or identifier.");
      return;
    }
    if (holdings.some((h) => h.kind === kind && h.symbol === normalized)) {
      setFormError("That asset is already in this portfolio.");
      return;
    }
    setHoldings([
      ...holdings,
      { kind, symbol: normalized, name: assetName.trim() },
    ]);
    setSymbol("");
    setAssetName("");
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

  return (
    <main className="app-shell">
      <nav className="topbar">
        <span className="brand">
          folio<span className="brand-dot">.</span>fm
        </span>
        <span className="topbar-note">PERSONAL PORTFOLIO INTELLIGENCE</span>
        <Link href="/api/auth/signout" className="nav-link">
          SIGN OUT ↗
        </Link>
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
          {isLoading && <p className="muted">Loading portfolios…</p>}
          {listError && <p className="error">{listError.message}</p>}
          {portfolios.map((portfolio) => (
            <button
              key={portfolio.id}
              className={`portfolio-item ${active?.id === portfolio.id ? "selected" : ""}`}
              onClick={() => {
                setSelectedId(portfolio.id);
                setExpandedStory(null);
                setView(null);
              }}
            >
              <span>{portfolio.name}</span>
              <small>{portfolio.holdings.length} ASSETS</small>
            </button>
          ))}
          <button className="add-portfolio" onClick={() => openEditor()}>
            + New portfolio
          </button>
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
                  Edit portfolio ↗
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
                  <button disabled={!stories.length}>Explore ↗</button>
                </div>
                {!stories.length && (
                  <p className="muted">
                    Questions become available when sourced stories arrive.
                  </p>
                )}
              </form>
              {storiesLoading ? (
                <div className="empty-state">Finding your stories…</div>
              ) : stories.length ? (
                <div className="stories">
                  {stories.map((story, index) => (
                    <article className="story" key={story.id}>
                      <div className="story-meta">
                        <span>STORY {String(index + 1).padStart(2, "0")}</span>
                        <span>
                          {story.assetKey.split(":")[1]} / {story.sourceName}
                        </span>
                      </div>
                      <h3>{story.title}</h3>
                      <p>{story.summary}</p>
                      {expandedStory === story.id && (
                        <div className="story-expanded">
                          <p>{story.content}</p>
                          {/^https:\/\//i.test(story.sourceUrl) && (
                            <a
                              href={story.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Read original ↗
                            </a>
                          )}
                        </div>
                      )}
                      <div className="story-actions">
                        <button
                          className="text-button"
                          onClick={() =>
                            setExpandedStory(
                              expandedStory === story.id ? null : story.id,
                            )
                          }
                        >
                          {expandedStory === story.id
                            ? "Show less −"
                            : "Read more +"}
                        </button>
                        <button
                          className="deep-button"
                          onClick={() => {
                            setView({
                              storyId: story.id,
                              question: "What matters most about this story?",
                            });
                          }}
                        >
                          Explore this story ↗
                        </button>
                      </div>
                      {expandedStory === story.id && (
                        <form
                          className="question-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (question.trim())
                              setView({
                                storyId: story.id,
                                question: question.trim(),
                              });
                          }}
                        >
                          <label htmlFor={`question-${story.id}`}>
                            GO DEEPER / ASK ANYTHING ABOUT THIS STORY
                          </label>
                          <div>
                            <input
                              id={`question-${story.id}`}
                              value={question}
                              onChange={(event) =>
                                setQuestion(event.target.value)
                              }
                              maxLength={500}
                              placeholder="What does this mean for the company?"
                              required
                            />
                            <button>Build my deep dive ↗</button>
                          </div>
                        </form>
                      )}
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
                  Create a portfolio ↗
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
        >
          <div className="editor">
            <div className="editor-top">
              <span className="eyebrow">YOUR WATCHLIST</span>
              <button
                onClick={() => setEditing(null)}
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
                />
                <input
                  aria-label="Asset name"
                  value={assetName}
                  onChange={(event) => setAssetName(event.target.value)}
                  placeholder="Asset name"
                  maxLength={100}
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
                disabled={create.isPending || update.isPending}
                onClick={savePortfolio}
              >
                {create.isPending || update.isPending
                  ? "Saving…"
                  : "Save portfolio ↗"}
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
          question={view.question}
          onClose={() => setView(null)}
        />
      )}
    </main>
  );
}
