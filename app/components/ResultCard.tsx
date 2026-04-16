"use client";

import { useRef, useState, useEffect } from "react";
import { IntensityAudit, TopTarget, PersonaType } from "@/lib/twitter";

const RANK_MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

interface Props {
  result: IntensityAudit;
  onReset?: () => void;
}

function getScoreGradient(score: number): string {
  if (score >= 70) return "var(--gradient-score-high)";
  if (score >= 40) return "var(--gradient-score-mid)";
  return "var(--gradient-score-low)";
}

function getPersonaBadgeClass(persona: PersonaType): string {
  switch (persona) {
    case "The Elite Glazer":
      return "persona-badge-glazer";
    case "The Reply Demon":
      return "persona-badge-demon";
    case "The Main Character":
      return "persona-badge-main";
    case "The Lurker":
      return "persona-badge-lurker";
    case "The Socialite":
      return "persona-badge-socialite";
    default:
      return "persona-badge-socialite";
  }
}

function getBarColor(idx: number): string {
  const colors = ["#f472b6", "#a855f7", "#3b82f6", "#06b6d4", "#22c55e"];
  return colors[idx % colors.length];
}

export default function ResultCard({ result, onReset }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [animateBars, setAnimateBars] = useState(false);
  const [scoreVisible, setScoreVisible] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setScoreVisible(true), 200);
    const t2 = setTimeout(() => setAnimateBars(true), 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const downloadCard = async () => {
    setDownloading(true);
    setIsExporting(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      if (!cardRef.current) return;
      await new Promise((r) => setTimeout(r, 100));
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: "#111124",
        scale: 2,
        useCORS: true,
        logging: false,
        allowTaint: true,
      });
      const link = document.createElement("a");
      link.download = `reply-guy-${result.username}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (e) {
      console.error(e);
      alert("Download failed. Try the copy button instead.");
    } finally {
      setDownloading(false);
      setIsExporting(false);
    }
  };

  const copyCard = async () => {
    setCopying(true);
    setIsExporting(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      if (!cardRef.current) return;
      await new Promise((r) => setTimeout(r, 100));
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: "#111124",
        scale: 2,
        useCORS: true,
        logging: false,
        allowTaint: true,
      });
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        alert("✅ Card copied to clipboard!");
      }, "image/png");
    } catch (e) {
      console.error(e);
      alert("Copy failed. Try downloading instead.");
    } finally {
      setCopying(false);
      setIsExporting(false);
    }
  };

  const shareOnX = () => {
    const text = `I just got my Reply Guy Intensity Audit 💀\n\n${result.personaEmoji} My persona: "${result.persona}"\n🔥 Intensity Score: ${result.intensityScore}/100\n📊 Daily Reply Velocity: ${result.dailyVelocity}/day\n${result.topTargets.length > 0 ? `\n👑 I glaze @${result.topTargets[0].handle} the most (${result.topTargets[0].percentage}% of my replies 😭)` : ""}\n\nCheck yours 👇\nhttps://areyouareplyguy.vercel.app`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const {
    username,
    displayName,
    avatarUrl,
    persona,
    personaEmoji,
    personaDescription,
    savageQuote,
    intensityScore,
    replyRatio,
    dailyVelocity,
    totalOutwardReplies,
    totalSelfReplies,
    totalPostsAnalyzed,
    topTargets,
    disclaimer,
  } = result;

  return (
    <section className="results-section" aria-label="Intensity Audit Results">
      <div className="card-wrapper">
        {/* ─── The Card ─── */}
        <div
          className={`result-card ${isExporting ? "rendering-image" : ""}`}
          ref={cardRef}
          id="result-card"
        >
          {/* Score Hero */}
          <div className="score-hero">
            {avatarUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={avatarUrl}
                alt={`@${username}`}
                className="score-hero-avatar"
                crossOrigin="anonymous"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div
                className="score-hero-avatar"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.6rem",
                }}
              >
                👤
              </div>
            )}
            <div className="score-hero-user">
              {displayName || `@${username}`}
            </div>
            <div className="score-hero-handle">@{username}</div>

            <div className="intensity-score-container">
              <div
                className="intensity-score-number"
                style={{
                  background: getScoreGradient(intensityScore),
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  animation: scoreVisible
                    ? "scoreReveal 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both"
                    : "none",
                  opacity: scoreVisible ? 1 : 0,
                }}
              >
                {intensityScore}
              </div>
              <div className="intensity-score-label">
                Intensity Score / 100
              </div>
            </div>
          </div>

          {/* Persona */}
          <div className="persona-section">
            <div className={`persona-badge ${getPersonaBadgeClass(persona)}`}>
              <span>{personaEmoji}</span>
              <span>{persona}</span>
            </div>
            <p className="persona-description">{personaDescription}</p>
            <p className="savage-quote">&ldquo;{savageQuote}&rdquo;</p>
          </div>

          {/* Stats Row */}
          <div className="stats-row">
            <div className="stat-cell">
              <div className="stat-num">{dailyVelocity}</div>
              <div className="stat-label">Replies / Day</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num">{replyRatio}%</div>
              <div className="stat-label">Reply %</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num">{totalOutwardReplies}</div>
              <div className="stat-label">Outward Replies</div>
            </div>
          </div>

          {/* Top Targets */}
          {topTargets.length > 0 && (
            <div className="targets-section">
              <div className="targets-header">
                👑 Who You Glaze Most
              </div>
              {topTargets.map((target, idx) => (
                <TargetRow key={target.handle} target={target} rank={idx} />
              ))}
            </div>
          )}

          {topTargets.length === 0 && (
            <div className="no-results">
              <span className="no-results-emoji">🦗</span>
              <p>No outward reply targets found. You&apos;re a silent observer.</p>
            </div>
          )}

          {/* Obsession Bars */}
          {topTargets.length > 0 && (
            <div className="obsession-bars" data-html2canvas-ignore="true">
              <div className="obsession-title">Obsession Distribution</div>
              {topTargets.map((target, idx) => (
                <div key={target.handle} className="obsession-row">
                  <span className="obsession-user">@{target.handle}</span>
                  <div className="obsession-bar-track">
                    <div
                      className="obsession-bar-fill"
                      style={{
                        width: animateBars ? `${target.percentage}%` : "0%",
                        background: `linear-gradient(90deg, ${getBarColor(idx)}, ${getBarColor(idx)}88)`,
                      }}
                    />
                  </div>
                  <span className="obsession-pct">{target.percentage}%</span>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="card-footer">
            <p className="card-disclaimer">{disclaimer}</p>
            <div className="card-branding">
              areyouareplyguy.vercel.app
            </div>
          </div>

          {/* Hidden teaser for export */}
          {topTargets.length > 5 && (
            <div className="lurker-teaser">
              + {topTargets.length - 5} more targets revealed on site 🕵️
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="action-buttons" role="group" aria-label="Share options">
          <button
            id="share-x-btn"
            className="action-btn action-btn-x"
            onClick={shareOnX}
          >
            𝕏 Share on X
          </button>
          <button
            id="download-card-btn"
            className="action-btn action-btn-primary"
            onClick={downloadCard}
            disabled={downloading}
          >
            {downloading ? "⏳ Saving…" : "⬇️ Download"}
          </button>
          <button
            id="copy-card-btn"
            className="action-btn action-btn-secondary"
            onClick={copyCard}
            disabled={copying}
          >
            {copying ? "⏳ Copying…" : "📋 Copy"}
          </button>
        </div>

        <div className="cta-loop">Now check your friends 👇</div>

        {onReset && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginTop: "16px",
            }}
          >
            <button
              className="analyze-btn"
              onClick={onReset}
              style={{
                width: "100%",
                justifyContent: "center",
                padding: "14px",
                fontSize: "1rem",
              }}
            >
              <span aria-hidden>↺</span> Try another handle
            </button>
          </div>
        )}

        {/* Breakdown Section */}
        <div
          style={{
            marginTop: 20,
            padding: "16px 20px",
            background: "rgba(255,255,255,0.02)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
              color: "var(--text-muted)",
              marginBottom: 12,
            }}
          >
            📊 Full Breakdown
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 8,
            }}
          >
            <BreakdownItem
              label="Total Posts"
              value={totalPostsAnalyzed}
            />
            <BreakdownItem label="Self-Threads" value={totalSelfReplies} />
            <BreakdownItem
              label="Outward Replies"
              value={totalOutwardReplies}
            />
            <BreakdownItem
              label="Unique Targets"
              value={topTargets.length}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Target Row Component ─────────────────────────────────────────────────────
function TargetRow({ target, rank }: { target: TopTarget; rank: number }) {
  const isHero = rank === 0;

  return (
    <div
      className={`target-item ${isHero ? "target-item-hero" : ""}`}
      aria-label={`Rank ${rank + 1}: @${target.handle}`}
    >
      <span className={`target-rank ${rank >= 3 ? "plain" : ""}`} aria-hidden>
        {RANK_MEDALS[rank] ?? `#${rank + 1}`}
      </span>

      <div className="target-main">
        <div className="target-handle">@{target.handle}</div>
        <div className="target-meta">
          {target.replyCount} replies
          {isHero && " — your #1 obsession 🔥"}
        </div>
      </div>

      <div className="target-stats">
        <div className="target-pct">{target.percentage}%</div>
        <div className="target-pct-label">of replies</div>
      </div>
    </div>
  );
}

// ─── Breakdown Item ───────────────────────────────────────────────────────────
function BreakdownItem({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "rgba(255,255,255,0.02)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div
        style={{
          fontSize: "1.1rem",
          fontWeight: 800,
          fontFamily: '"Space Grotesk", sans-serif',
          color: "var(--text-primary)",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: "0.68rem",
          color: "var(--text-muted)",
          textTransform: "uppercase" as const,
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
    </div>
  );
}
