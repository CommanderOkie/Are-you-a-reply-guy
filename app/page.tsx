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

  // Fetch social proof stats on mount
  useEffect(() => {
    fetch("/api/stats")
      .then((res) => res.json())
      .then((data) => setStats(data))
      .catch(() => {});
  }, []);

  // Cycle loading messages while analyzing
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

      // HTTP 202 — Waitlist
      if (res.status === 202) {
        const data = await res.json();
        setQueueMessage(
          `⏳ You're #${data.position} in queue (~${data.estimatedWait}s wait)`
        );
        setTimeout(() => handleAnalyze(raw), 4000);
        return;
      }

      // 429 — Rate limited
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

  return (
    <main>
      {/* Animated background */}
      <div className="bg-grid" aria-hidden />
      <div className="bg-orb bg-orb-1" aria-hidden />
      <div className="bg-orb bg-orb-2" aria-hidden />
      <div className="bg-orb bg-orb-3" aria-hidden />

      {/* ── Hero ── */}
      <header className="header">
        <div className="header-tag">
          <span>✦</span>
          <span>Reply Intensity Audit</span>
        </div>

        <h1 className="header-title">
          Are You a{" "}
          <span className="gradient-text">Reply Guy?</span>
        </h1>

        <p className="header-sub">
          Enter your Twitter/X handle and get a brutally honest audit of your
          replying habits. Who do you glaze? How intense are you? Find out. 💀
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
            placeholder="@yourusername"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
            disabled={loading}
            aria-label="Your Twitter/X username"
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
            {loading ? (
              <>
                <span
                  style={{
                    display: "inline-block",
                    animation: "spin 0.8s linear infinite",
                  }}
                >
                  ⟳
                </span>
                Auditing…
              </>
            ) : (
              <>
                <span>💀</span> Audit Me
              </>
            )}
          </button>
        </div>

        {/* Quick-picks */}
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

      {/* ── Loading ── */}
      {loading && (
        <section
          className="loading-state"
          aria-live="polite"
          aria-label="Analyzing"
        >
          <div className="loading-spinner" />
          <p
            className="loading-text"
            style={{ color: queueMessage ? "#f472b6" : "inherit" }}
          >
            {queueMessage ? queueMessage : LOADING_STEPS[loadingStep].text}
          </p>
          <p className="loading-sub">
            Scraping your Replies tab — takes ~15-25s ⚡
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

      <footer className="site-footer">
        Not affiliated with X / Twitter &middot; For entertainment only
        <br />
        <a
          href="https://x.com/okiewins"
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginTop: 8, display: "inline-block" }}
        >
          Made by Avee
        </a>
      </footer>
    </main>
  );
}
