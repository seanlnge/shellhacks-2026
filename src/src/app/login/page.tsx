import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signIn } from "~/server/auth";
import { Brand } from "~/app/_components/brand";

import styles from "./login.module.css";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="Infinifolio home">
          <Brand />
        </Link>
        <span className={styles.headerLabel}>
          PERSONAL PORTFOLIO INTELLIGENCE
        </span>
        <span className={styles.headerIndex}>ACCESS / 01</span>
      </header>

      <div className={styles.layout}>
        <section className={styles.intro} aria-labelledby="login-title">
          <div className={styles.introTop}>
            <span className={styles.kicker}>A CLEARER PERSPECTIVE</span>
            <span className={styles.index}>01 — 02</span>
          </div>
          <div className={styles.introBody}>
            <p className={styles.overline}>YOUR PRIVATE BRIEFING</p>
            <h1 id="login-title">
              Know more.
              <br />
              <em>Move with clarity.</em>
            </h1>
            <p className={styles.description}>
              A considered view of the developments shaping your holdings. Less
              noise, more of what matters to your portfolio.
            </p>
          </div>
          <div className={styles.introBottom}>
            <span>BUILT FOR THE CONSIDERED INVESTOR</span>
            <span>INFINIFOLIO / 2026</span>
          </div>
        </section>

        <section className={styles.access} aria-labelledby="access-title">
          <div className={styles.accessTop}>
            <span>SECURE ACCESS</span>
            <span aria-hidden="true">↗</span>
          </div>
          <div className={styles.accessBody}>
            <span className={styles.accessNumber}>01 / YOUR ACCOUNT</span>
            <h2 id="access-title">
              Welcome to
              <br />
              your briefing.
            </h2>
            <p>
              Sign in to follow your holdings and explore the context behind
              every move.
            </p>
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/" });
              }}
            >
              <button className={styles.signInButton} type="submit">
                <span className={styles.googleMark} aria-hidden="true">
                  G
                </span>
                <span>Continue with Google</span>
                <span className={styles.buttonArrow} aria-hidden="true">
                  ↗
                </span>
              </button>
            </form>
            <p className={styles.accessFootnote}>
              One secure sign-in. Your briefing, ready when you are.
            </p>
          </div>
          <div className={styles.accessBottom}>
            <span>AN INTELLIGENT VIEW OF WHAT YOU OWN</span>
            <span>EST. 2026</span>
          </div>
        </section>
      </div>
    </main>
  );
}
