import React, { useState } from 'react';

// ─── Word dictionaries ────────────────────────────────────────────────────────
const STRONG = new Set([
  'evidence','because','data','research','study','studies','proves','proven',
  'demonstrate','demonstrates','shows','clearly','therefore','consequently',
  'furthermore','moreover','however','although','despite','indeed',
  'significant','critical','essential','fundamental','crucial','ultimately',
  'specifically','particularly','undeniably','conclusively','statistically',
  'empirically','according','confirms','established','scientific','analysis',
  'fact','facts','supports','logical','reasoning','definitely','absolutely',
  'directly','certainly','argument','based','prove','actual','actually',
  'conclude','conclusion','obviously','truth','truly','real','reality',
]);

const WEAK = new Set([
  'maybe','perhaps','might','could','think','feel','seems','appears',
  'somewhat','possibly','probably','guess','hopefully','basically',
  'literally','anyway','just','simply','fairly','rather','quite',
  'pretty','almost','nearly','generally','usually','often','sort','kind',
  'vaguely','roughly','loosely','unsure',
]);

const CONNECTIVES = new Set([
  'therefore','however','furthermore','because','although','consequently',
  'moreover','despite','additionally','nevertheless','whereas','hence',
  'accordingly','nonetheless','subsequently',
]);

type Tone = 'confident' | 'neutral' | 'uncertain' | 'aggressive';

interface FeedbackItem {
  type: 'strength' | 'weakness' | 'suggestion';
  icon: string;
  title: string;
  detail: string;
  fix?: string;
}

interface Result {
  foundStrong: string[];
  foundWeak: string[];
  strongCount: number;
  weakCount: number;
  wordCount: number;
  sentenceCount: number;
  tone: Tone;
  toneConfidence: number;
  flowScore: number;
  clarityScore: number;
  impactScore: number;
  overallScore: number;
  feedback: FeedbackItem[];
}

// ─── Analysis engine ──────────────────────────────────────────────────────────
function analyse(text: string): Result {
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 3);
  const wc = words.length;
  const sc = Math.max(sentences.length, 1);

  const foundStrong: string[] = [];
  const foundWeak: string[] = [];
  words.forEach(w => {
    if (STRONG.has(w) && !foundStrong.includes(w)) foundStrong.push(w);
    if (WEAK.has(w)   && !foundWeak.includes(w))   foundWeak.push(w);
  });
  const strongCount   = words.filter(w => STRONG.has(w)).length;
  const weakCount     = words.filter(w => WEAK.has(w)).length;
  const connCount     = words.filter(w => CONNECTIVES.has(w)).length;
  const strongRatio   = wc > 0 ? strongCount / wc : 0;
  const weakRatio     = wc > 0 ? weakCount   / wc : 0;

  const excl    = (text.match(/!/g) || []).length;
  const caps    = (text.match(/\b[A-Z]{3,}\b/g) || []).length;

  let tone: Tone = 'neutral';
  let toneConfidence = 65;
  if (caps >= 2 || excl >= 3) {
    tone = 'aggressive';
    toneConfidence = Math.min(95, 65 + caps * 7 + excl * 4);
  } else if (weakRatio > 0.1) {
    tone = 'uncertain';
    toneConfidence = Math.min(90, 60 + Math.round(weakRatio * 150));
  } else if (strongRatio >= 0.07) {
    tone = 'confident';
    toneConfidence = Math.min(95, 60 + Math.round(strongRatio * 200) + excl * 2);
  }

  const avgSL   = wc / sc;
  const flowBase = (avgSL >= 10 && avgSL <= 22) ? 78 : avgSL < 10 ? 52 : 60;
  const flowScore = Math.min(100, Math.max(10, Math.round(flowBase + connCount * 5 + Math.min(wc / 5, 10))));

  const avgWL       = wc > 0 ? words.join('').length / wc : 5;
  const clarityBase = avgWL < 5 ? 84 : avgWL < 7 ? 70 : 54;
  const clarityScore = Math.min(100, Math.max(10, Math.round(clarityBase + Math.min(wc / 8, 12) - weakCount * 2)));

  const impactScore = Math.min(100, Math.max(10, Math.round(strongRatio * 450 + Math.min(wc / 6, 20) + excl * 3)));

  const overallScore = Math.min(100, Math.max(5, Math.round(
    flowScore * 0.25 + clarityScore * 0.25 + impactScore * 0.35 + Math.max(0, 100 - weakRatio * 300) * 0.15
  )));

  // ── Feedback ──────────────────────────────────────────────────────────────
  const feedback: FeedbackItem[] = [];

  if (strongCount >= 2) {
    feedback.push({
      type: 'strength', icon: '✅',
      title: 'Evidence-Based Language',
      detail: `You used ${strongCount} strong analytical words (e.g. "${foundStrong.slice(0,3).join('", "')}"), adding credibility.`,
    });
  }
  if (sc >= 3) {
    feedback.push({
      type: 'strength', icon: '✅',
      title: 'Structured Argument',
      detail: `Your ${sc}-sentence structure allows proper development of your position.`,
    });
  }
  if (connCount > 0) {
    feedback.push({
      type: 'strength', icon: '✅',
      title: 'Logical Flow',
      detail: `Good use of ${connCount} connective word(s) — your argument flows logically.`,
    });
  }
  if (weakCount > 0) {
    feedback.push({
      type: 'weakness', icon: '⚠️',
      title: 'Hedging Language Detected',
      detail: `"${foundWeak.slice(0,3).join('", "')}" — these signal uncertainty and weaken your stance.`,
      fix: `Replace hedges with direct assertions. Not "I think AI might…" → "AI demonstrably…"`,
    });
  }
  if (strongCount === 0) {
    feedback.push({
      type: 'weakness', icon: '⚠️',
      title: 'No Evidential Support',
      detail: 'No evidence-based language found. Claims without data are easily dismissed.',
      fix: `Add: "Studies show…", "Data confirms…", "Evidence demonstrates…"`,
    });
  }
  if (wc < 30) {
    feedback.push({
      type: 'weakness', icon: '⚠️',
      title: 'Argument Too Brief',
      detail: `${wc} words is insufficient. Competitive debaters average 80–120 words per rebuttal.`,
      fix: 'Add: (1) a specific example, (2) a counterpoint, (3) a closing impact statement.',
    });
  }
  if (connCount === 0 && wc > 20) {
    feedback.push({
      type: 'suggestion', icon: '💡',
      title: 'Add Logical Connectives',
      detail: 'Missing transition words make your argument harder to follow.',
      fix: 'Use: "therefore", "consequently", "furthermore", "however", "despite this".',
    });
  }
  if (avgSL > 25) {
    feedback.push({
      type: 'suggestion', icon: '💡',
      title: 'Sentences Are Too Long',
      detail: `Avg sentence: ${Math.round(avgSL)} words. Long sentences dilute impact.`,
      fix: 'Break complex ideas into 2–3 shorter, punchy sentences.',
    });
  }
  if (feedback.filter(f => f.type === 'suggestion').length === 0) {
    feedback.push({
      type: 'suggestion', icon: '💡',
      title: 'Strengthen Your Closing',
      detail: 'End with a clear impact statement that tells the audience WHY it matters.',
      fix: '"Ultimately, [position] because [consequence]. This is why [your side] must prevail."',
    });
  }

  return {
    foundStrong, foundWeak,
    strongCount, weakCount,
    wordCount: wc, sentenceCount: sc,
    tone, toneConfidence,
    flowScore, clarityScore, impactScore, overallScore,
    feedback,
  };
}

// ─── Ring component ───────────────────────────────────────────────────────────
function Ring({ score, color, size, label }: { score: number; color: string; size: 'lg' | 'sm'; label: string }) {
  const r  = size === 'lg' ? 54 : 36;
  const cx = size === 'lg' ? 60 : 40;
  const cy = size === 'lg' ? 60 : 40;
  const vb = size === 'lg' ? '0 0 120 120' : '0 0 80 80';
  const sw = size === 'lg' ? 9 : 7;
  const fs = size === 'lg' ? 22 : 15;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  return (
    <div className="ad-ring-wrap">
      <svg viewBox={vb} className={`ad-ring-svg ad-ring--${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={sw} />
        <circle
          cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dasharray 1.1s cubic-bezier(.4,0,.2,1)' }}
        />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle"
          fill="#f1f5f9" fontSize={fs} fontWeight="700">{score}</text>
      </svg>
      <p className="ad-ring-label">{label}</p>
    </div>
  );
}

// ─── Tone badge ────────────────────────────────────────────────────────────────
const TONE_META: Record<Tone, { color: string; emoji: string; desc: string }> = {
  confident:  { color: '#22c55e', emoji: '💪', desc: 'Your delivery is assertive and authoritative.' },
  neutral:    { color: '#3b82f6', emoji: '⚖️',  desc: 'Balanced and measured. Consider adding more conviction.' },
  uncertain:  { color: '#f59e0b', emoji: '😟', desc: 'Hedging language undermines your credibility.' },
  aggressive: { color: '#ef4444', emoji: '🔥', desc: 'Very forceful — ensure facts back your passion.' },
};

// ─── Main component ────────────────────────────────────────────────────────────
interface Props {
  initialText?: string;   // pre-fill (embedded mode in main app)
  onGetStarted?: () => void;
  showCTA?: boolean;
}

function AnalysisDashboard({ initialText = '', onGetStarted, showCTA = false }: Props) {
  const [text, setText]       = useState(initialText);
  const [result, setResult]   = useState<Result | null>(initialText ? analyse(initialText) : null);
  const [loading, setLoading] = useState(false);

  const handleAnalyse = () => {
    if (text.trim().length < 5) return;
    setLoading(true);
    setTimeout(() => {
      setResult(analyse(text));
      setLoading(false);
    }, 700);
  };

  const wc = text.trim() ? (text.match(/\b\w+\b/g) || []).length : 0;

  return (
    <div className="ad-root">
      {/* ── Input panel ──────────────────────────────────────────────── */}
      {!initialText && (
        <div className="ad-input-panel">
          <div className="ad-input-header">
            <div>
              <p className="ad-input-label">🎤 Your Rebuttal</p>
              <p className="ad-input-sublabel">
                Topic: <em>Is Artificial Intelligence beneficial to humanity?</em>
              </p>
            </div>
            <span className="ad-word-counter">{wc} words</span>
          </div>
          <textarea
            className="ad-textarea"
            placeholder="Write your counter-argument… (tip: use 'because', 'evidence', 'data' for stronger scores)"
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <button
            className="ad-analyse-btn"
            onClick={handleAnalyse}
            disabled={loading || wc < 2}
          >
            {loading ? (
              <span className="ad-spinner" />
            ) : (
              <>🔬 Analyse Argument</>
            )}
          </button>
        </div>
      )}

      {/* ── Results dashboard ─────────────────────────────────────────── */}
      {result && (
        <div className="ad-dashboard">

          {/* Score row */}
          <div className="ad-score-row">
            <div className="ad-overall-ring">
              <Ring score={result.overallScore} color={
                result.overallScore >= 75 ? '#22c55e' :
                result.overallScore >= 50 ? '#38bdf8' : '#f59e0b'
              } size="lg" label="Overall Score" />
              <p className="ad-score-grade">
                {result.overallScore >= 85 ? 'Excellent 🏆' :
                 result.overallScore >= 70 ? 'Strong 💪' :
                 result.overallScore >= 50 ? 'Developing 📈' : 'Needs Work 📚'}
              </p>
            </div>
            <div className="ad-metric-rings">
              <Ring score={result.flowScore}    color="#38bdf8" size="sm" label="Flow" />
              <Ring score={result.clarityScore} color="#22c55e" size="sm" label="Clarity" />
              <Ring score={result.impactScore}  color="#f59e0b" size="sm" label="Impact" />
            </div>
          </div>

          {/* Middle row: tone + word analysis */}
          <div className="ad-middle-row">
            {/* Tone card */}
            <div className="ad-card ad-tone-card">
              <p className="ad-card-title">🎭 Speech Tone</p>
              <div className="ad-tone-badge" style={{ borderColor: TONE_META[result.tone].color, color: TONE_META[result.tone].color }}>
                {TONE_META[result.tone].emoji} {result.tone.charAt(0).toUpperCase() + result.tone.slice(1)}
              </div>
              <div className="ad-tone-bar-wrap">
                <div className="ad-tone-bar" style={{ width: `${result.toneConfidence}%`, background: TONE_META[result.tone].color }} />
              </div>
              <p className="ad-tone-pct">{result.toneConfidence}% confidence</p>
              <p className="ad-tone-desc">{TONE_META[result.tone].desc}</p>
            </div>

            {/* Word analysis card */}
            <div className="ad-card ad-words-card">
              <p className="ad-card-title">🔤 Word Type Analysis</p>
              <div className="ad-words-stats">
                <div className="ad-words-stat">
                  <span className="ad-words-num ad-words-num--strong">{result.strongCount}</span>
                  <span className="ad-words-lbl">Strong words</span>
                </div>
                <div className="ad-words-divider" />
                <div className="ad-words-stat">
                  <span className="ad-words-num ad-words-num--weak">{result.weakCount}</span>
                  <span className="ad-words-lbl">Weak words</span>
                </div>
                <div className="ad-words-divider" />
                <div className="ad-words-stat">
                  <span className="ad-words-num" style={{ color: '#94a3b8' }}>{result.wordCount}</span>
                  <span className="ad-words-lbl">Total words</span>
                </div>
              </div>
              {result.foundStrong.length > 0 && (
                <div className="ad-pill-row">
                  {result.foundStrong.slice(0, 6).map(w => (
                    <span key={w} className="ad-pill ad-pill--strong">{w}</span>
                  ))}
                </div>
              )}
              {result.foundWeak.length > 0 && (
                <div className="ad-pill-row">
                  {result.foundWeak.slice(0, 6).map(w => (
                    <span key={w} className="ad-pill ad-pill--weak">{w}</span>
                  ))}
                </div>
              )}
              {result.foundStrong.length === 0 && result.foundWeak.length === 0 && (
                <p className="ad-no-words">No strong or weak words detected yet.</p>
              )}
            </div>

            {/* Delivery stats card */}
            <div className="ad-card ad-delivery-card">
              <p className="ad-card-title">🔊 Delivery Metrics</p>
              {([
                { label: 'Flow',         score: result.flowScore,    color: '#38bdf8', desc: 'Sentence rhythm & connectives' },
                { label: 'Clarity',      score: result.clarityScore, color: '#22c55e', desc: 'Readability & directness' },
                { label: 'Impact',       score: result.impactScore,  color: '#f59e0b', desc: 'Persuasive strength' },
              ] as const).map(m => (
                <div key={m.label} className="ad-delivery-row">
                  <div className="ad-delivery-meta">
                    <span className="ad-delivery-label">{m.label}</span>
                    <span className="ad-delivery-val" style={{ color: m.color }}>{m.score}</span>
                  </div>
                  <div className="ad-delivery-bar-bg">
                    <div className="ad-delivery-bar-fill" style={{ width: `${m.score}%`, background: m.color }} />
                  </div>
                  <p className="ad-delivery-desc">{m.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Feedback section */}
          <div className="ad-feedback-section">
            <p className="ad-section-title">📋 Structured Feedback</p>
            <div className="ad-feedback-grid">
              {result.feedback.map((f, i) => (
                <div key={i} className={`ad-feedback-card ad-feedback-card--${f.type}`}>
                  <div className="ad-feedback-top">
                    <span className="ad-feedback-icon">{f.icon}</span>
                    <span className="ad-feedback-title">{f.title}</span>
                  </div>
                  <p className="ad-feedback-detail">{f.detail}</p>
                  {f.fix && (
                    <div className="ad-feedback-fix">
                      <span className="ad-fix-label">Suggestion:</span>
                      <p className="ad-fix-text">{f.fix}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          {showCTA && onGetStarted && (
            <div className="ad-cta">
              <p>Want real-time voice debate with AI opponents & full history tracking?</p>
              <button className="lp-btn-accent" onClick={onGetStarted}>
                Create Free Account →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AnalysisDashboard;
