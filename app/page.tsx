"use client";

import { useState, useRef, useEffect } from "react";
import ResultCard from "./components/ResultCard";
import { IntensityAudit } from "@/lib/twitter";

const LOADING_STEPS = [
  { text: "Scanning your mentions...", icon: "👀" },
  { text: "Measuring your glaze levels...", icon: "🍩" },
  { text: "Assembling the evidence...", icon: "📋" },
  { text: "Calculating your intensity score...", icon: "🔥" },
];

const EXAMPLE_ACCOUNTS = ["elonmusk", "sama", "naval", "pmarca", "levelsio"];

const FAKE_TICKER = [
  { user: "@cryptobro99", score: 87, persona: "The Reply Demon" },
  { user: "@web3maxi", score: 42, persona: "The Socialite" },
  { user: "@defi_whale", score: 94, persona: "The Elite Glazer" },
  { user: "@nft_degen", score: 12, persona: "The Lurker" },
];

const FAQ_ITEMS = [
  {
    q: "How does the audit work?",
    a: "We scan your Twitter/X Replies tab using their API, analyzing your last 7 days of activity. We count your outward replies, self-threads, and identify your most-replied-to accounts.",
  },
  {
    q: "Is my data stored?",
    a: "No. We don't store your tweets, replies, or any personal data. The analysis is performed in real-time and results are cached briefly for performance only.",
  },
  {
    q: "What's the Intensity Score?",
    a: "It's a 0-100 score based on your daily reply velocity, reply percentage, target concentration, and total volume. Higher scores mean you're more of a reply guy.",
  },
  {
    q: "Why does it take 15-60 seconds?",
    a: "We scan up to 50 pages of your Twitter activity to get the most accurate picture. Very active users (300+ replies/day) require more pages to cover the full 7-day window.",
  },
  {
    q: "Can I audit someone else?",
    a: "Yes! Enter any public Twitter/X handle to see their reply intensity. Find out who's the biggest reply guy in your circle.",
  },
];

export default function Home() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [result, setResult] = useState<IntensityAudit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<{
    totalAudits: number;
    trending: string[];
  } | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((res) => res.json())
      .then((data) => setStats(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading) return;
    setLoadingStep(0);
    const id = setInterval(() => {
      setLoadingStep((p) => (p < LOADING_STEPS.length - 1 ? p + 1 : p));
    }, 4000);
    return () => clearInterval(id);
  }, [loading]);

  const handleAnalyze = async (overrideUsername?: string) => {
    const raw = (overrideUsername ?? username).replace(/^@/, "").trim();
    if (!raw) return;
    if (!/^[a-zA-Z0-9_]{1,50}$/.test(raw)) {
      setError(
        "Invalid username. Only letters, numbers, and underscores allowed."
      );
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const isRetry = !!queueMessage;
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-is-retry": isRetry ? "true" : "false",
        },
        body: JSON.stringify({ username: raw }),
      });

      if (res.status === 202) {
        const data = await res.json();
        setQueueMessage(
          `⏳ You're #${data.position} in queue (~${data.estimatedWait}s wait)`
        );
        setTimeout(() => handleAnalyze(raw), 4000);
        return;
      }

      if (res.status === 429) {
        setQueueMessage(
          "Cooling down... Too many requests. Retrying in 10s 🐢"
        );
        setTimeout(() => handleAnalyze(raw), 10000);
        return;
      }

      if (!res.ok) {
        try {
          const data = await res.json();
          setError(data.error || "Something went wrong. Please try again.");
        } catch {
          setError("Server returned an error. Please try again.");
        }
        setQueueMessage(null);
        setLoading(false);
        return;
      }

      const msg = await res.json();
      if (msg.error) {
        setError(msg.error);
        setQueueMessage(null);
        setLoading(false);
        return;
      }

      setResult(msg as IntensityAudit);
      setQueueMessage(null);
      setTimeout(
        () =>
          resultsRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        100
      );
      setLoading(false);
    } catch {
      setError("Network error. Check your connection and try again.");
      setQueueMessage(null);
      setLoading(false);
    }
  };

  const tryExample = (handle: string) => {
    setUsername(handle);
    handleAnalyze(handle);
  };

  const showLanding = !loading && !result && !error;

  return (
    <main>
      {/* Background elements — subtle, Dimension-style */}
      <div className="bg-grid" aria-hidden />
      <div className="bg-arc" aria-hidden />
      <div className="bg-arc-2" aria-hidden />
      <div className="bg-glow" aria-hidden />

      {/* ── Hero ── */}
      <header className="header">
        <div className="header-tag">
          <span>✦</span>
          <span>Reply Intensity Audit</span>
        </div>

        <h1 className="header-title">
          Are you a<br />
          <span>
            <span className="gradient-text">reply </span>
            <span className="glitch-swap-container">
              <span className="glitch-word"><span className="gradient-text">guy?</span></span>
              <span className="glitch-word"><span className="gradient-text">gal?</span></span>
            </span>
          </span>
        </h1>

        <p className="header-sub">
          Enter any Twitter/X handle and get a brutally honest audit of
          replying habits. We scan 7 days of data to find the truth.
        </p>

        {stats && stats.totalAudits > 0 && (
          <div className="total-audits-badge">
            <span className="pulse-icon">🔥</span>
            <span>{stats.totalAudits.toLocaleString()} audits completed</span>
          </div>
        )}
      </header>

      {/* ── Input ── */}
      <section className="input-section" aria-label="Username input">
        <div className="input-wrapper">
          <input
            id="username-input"
            className="username-input"
            type="text"
            placeholder="Enter username..."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
            disabled={loading}
            aria-label="Twitter/X username"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
          />
          <button
            id="analyze-btn"
            className="analyze-btn"
            onClick={() => handleAnalyze()}
            disabled={loading || !username.trim()}
          >
            {loading ? "Auditing…" : "Audit"}
          </button>
        </div>

        {!loading && !result && (
          <div className="example-row" aria-label="Try these">
            <span className="example-label">
              {stats && stats.trending.length > 0 ? "Trending:" : "Try:"}
            </span>
            {(stats && stats.trending.length > 0
              ? stats.trending
              : EXAMPLE_ACCOUNTS
            ).map((handle) => (
              <button
                key={handle}
                className="example-chip"
                onClick={() => tryExample(handle)}
                type="button"
              >
                @{handle}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── Live Ticker ── */}
      {showLanding && (
        <div className="ticker-section">
          <div className="ticker-container">
            <div className="ticker-header">
              <div className="ticker-live-dot" />
              <span>Recent Audits</span>
            </div>
            <div className="ticker-scroll">
              {FAKE_TICKER.map((item, i) => (
                <div
                  key={i}
                  className="ticker-item"
                  style={{ animationDelay: `${i * 0.08}s` }}
                >
                  <span>
                    <span className="ticker-user">{item.user}</span>{" "}
                    <span className="ticker-persona">— {item.persona}</span>
                  </span>
                  <span
                    className={`ticker-score ${
                      item.score >= 70
                        ? "ticker-score-high"
                        : item.score >= 40
                        ? "ticker-score-mid"
                        : "ticker-score-low"
                    }`}
                  >
                    {item.score}/100
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <section className="loading-state" aria-live="polite">
          <div className="loading-spinner" />
          <p
            className="loading-text"
            style={{ color: queueMessage ? "#f472b6" : "inherit" }}
          >
            {queueMessage ? queueMessage : LOADING_STEPS[loadingStep].text}
          </p>
          <p className="loading-sub">
            Scraping the Replies tab — takes ~15-60s ⚡
          </p>
          <div className="loading-steps">
            {LOADING_STEPS.slice(0, loadingStep + 1).map((step, i) => (
              <div
                key={i}
                className={`loading-step ${
                  i === loadingStep ? "step-active" : "step-done"
                }`}
              >
                <span className="loading-step-icon">{step.icon}</span>
                <span>{step.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Error ── */}
      {!loading && error && (
        <section className="error-state" aria-live="polite">
          <div className="error-card">
            <div className="error-header">
              <span>{error.includes("rate") ? "🚦" : "🚫"}</span>
              <span>
                {error.includes("rate") ? "Slow Down!" : "Audit Failed"}
              </span>
            </div>
            <p className="error-message">{error}</p>
            <button
              className="error-retry-btn"
              onClick={() => handleAnalyze()}
            >
              ↺ Try again
            </button>
          </div>
        </section>
      )}

      {/* ── Results ── */}
      {!loading && result && (
        <div ref={resultsRef}>
          <ResultCard
            result={result}
            onReset={() => {
              setResult(null);
              setUsername("");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </div>
      )}

      {/* ── How It Works ── */}
      {showLanding && (
        <>
          <div className="section-divider" />
          <section className="how-section">
            <h2 className="how-title">How it works</h2>
            <p className="how-subtitle">
              Three steps to discover the truth about your reply habits
            </p>
            <div className="how-steps">
              <div className="how-step">
                <div>
                  <div className="how-step-number">1</div>
                  <span className="how-step-icon">🔍</span>
                </div>
                <div>
                  <div className="how-step-title">Enter a handle</div>
                  <p className="how-step-desc">
                    Type any public Twitter/X username to begin
                  </p>
                </div>
              </div>
              <div className="how-step">
                <div>
                  <div className="how-step-number">2</div>
                  <span className="how-step-icon">📊</span>
                </div>
                <div>
                  <div className="how-step-title">We scan 7 days</div>
                  <p className="how-step-desc">
                    Our engine crawls up to 2,000 posts from the Replies tab
                  </p>
                </div>
              </div>
              <div className="how-step">
                <div>
                  <div className="how-step-number">3</div>
                  <span className="how-step-icon">💀</span>
                </div>
                <div>
                  <div className="how-step-title">Get your verdict</div>
                  <p className="how-step-desc">
                    See your score, persona, and who you glaze the most
                  </p>
                </div>
              </div>
            </div>
          </section>

          <div className="section-divider" />

          <section className="faq-section">
            <h2 className="faq-title">Frequently asked questions</h2>
            {FAQ_ITEMS.map((item, i) => (
              <div key={i} className="faq-item">
                <button
                  className="faq-question"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span>{item.q}</span>
                  <span
                    className={`faq-chevron ${openFaq === i ? "open" : ""}`}
                  >
                    ▾
                  </span>
                </button>
                {openFaq === i && <div className="faq-answer">{item.a}</div>}
              </div>
            ))}
          </section>
        </>
      )}

      <footer className="site-footer">
        Not affiliated with X / Twitter · For entertainment only
        <br />
        <a
          href="https://x.com/okiewins"
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginTop: 6, display: "inline-block" }}
        >
          Made by Avee
        </a>
      </footer>
    </main>
  );
}
