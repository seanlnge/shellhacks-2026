import Link from "next/link";

import { Dashboard } from "~/app/_components/dashboard";
import { auth } from "~/server/auth";

export default async function Home() {
  const session = await auth();
  return session?.user ? (
    <Dashboard userName={session.user.name ?? "Investor"} />
  ) : (
    <main className="landing">
      <nav className="topbar">
        <span className="brand">
          folio<span className="brand-dot">.</span>fm
        </span>
        <span className="topbar-note">YOUR MARKET, IN FOCUS</span>
      </nav>
      <div className="landing-content">
        <p className="eyebrow">THE PERSONAL PORTFOLIO BRIEFING</p>
        <h1>
          Follow the story
          <br />
          <em>behind the ticker.</em>
        </h1>
        <p className="landing-copy">
          The news that matters to your holdings, told in a format worth
          exploring. One portfolio. Every angle.
        </p>
        <Link href="/api/auth/signin" className="primary-button">
          Start your briefing <span aria-hidden="true">↗</span>
        </Link>
      </div>
      <div className="landing-bottom">
        <span>01 / BUILD YOUR WATCHLIST</span>
        <span>02 / FOLLOW THE SIGNAL</span>
        <span>03 / GO DEEPER</span>
      </div>
    </main>
  );
}
