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
        <span className="topbar-note">PERSONAL PORTFOLIO INTELLIGENCE</span>
      </nav>
      <div className="landing-content">
        <p className="eyebrow">A MORE CONSIDERED VIEW OF YOUR PORTFOLIO</p>
        <h1>
          Clarity behind
          <br />
          <em>every holding.</em>
        </h1>
        <p className="landing-copy">
          The developments that matter to your holdings, distilled into a
          considered briefing. Explore the context behind every decision.
        </p>
        <Link href="/api/auth/signin" className="primary-button">
          Enter your briefing <span aria-hidden="true">↗</span>
        </Link>
      </div>
      <div className="landing-bottom">
        <span>01 / DEFINE YOUR PORTFOLIO</span>
        <span>02 / REVIEW THE DEVELOPMENTS</span>
        <span>03 / EXPLORE THE DETAIL</span>
      </div>
    </main>
  );
}
