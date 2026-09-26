import React, { useState } from 'react';
import AnalysisDashboard from './AnalysisDashboard';

interface LandingPageProps {
  onGetStarted: () => void;
}

function LandingPage({ onGetStarted }: LandingPageProps) {
  const [navOpen, setNavOpen] = useState(false);


  return (
    <div className="lp-root">
      {/* BACKGROUND LAYERS */}
      <div className="lp-bg-glow lp-bg-glow--blue" />
      <div className="lp-bg-glow lp-bg-glow--green" />
      <div className="lp-grid-overlay" />

      {/* NAVBAR */}
      <nav className="lp-nav">
        <div className="lp-nav-brand">
          <span className="lp-brand-icon">🤖</span>
          <span className="lp-brand-name">DebateAI</span>
        </div>
        <div className={`lp-nav-links ${navOpen ? 'open' : ''}`}>
          <a href="#about" className="lp-nav-link">About</a>
          <a href="#features" className="lp-nav-link">Features</a>
          <a href="#demo" className="lp-nav-link">Demo</a>
          <a href="#contact" className="lp-nav-link">Contact</a>
          <button className="lp-nav-cta" onClick={onGetStarted}>
            Get Started →
          </button>
        </div>
        <button className="lp-hamburger" onClick={() => setNavOpen(!navOpen)}>
          {navOpen ? '✕' : '☰'}
        </button>
      </nav>

      {/* HERO */}
      <section className="lp-hero">
        <div className="lp-hero-badge">✦ Powered by Groq AI</div>
        <h1 className="lp-hero-title">
          AI <span className="lp-gradient-text">Debate</span> Coach
        </h1>
        <p className="lp-hero-subtitle">
          Sharpen logic. Master arguments. Outsmart opponents.
        </p>
        <div className="lp-hero-actions">
          <button className="lp-btn-primary" onClick={onGetStarted}>
            Start Debating Free
          </button>
          <a href="#demo" className="lp-btn-secondary">
            Try Live Demo ↓
          </a>
        </div>
        <div className="lp-hero-stats">
          <div className="lp-stat">
            <span className="lp-stat-num">1000+</span>
            <span className="lp-stat-label">Debates Analyzed</span>
          </div>
          <div className="lp-stat-divider" />
          <div className="lp-stat">
            <span className="lp-stat-num">98%</span>
            <span className="lp-stat-label">User Satisfaction</span>
          </div>
          <div className="lp-stat-divider" />
          <div className="lp-stat">
            <span className="lp-stat-num">Real‑Time</span>
            <span className="lp-stat-label">AI Feedback</span>
          </div>
        </div>
      </section>

      {/* ABOUT */}
      <section id="about" className="lp-section">
        <div className="lp-card lp-card--about">
          <div className="lp-card-label">📌 About</div>
          <h2 className="lp-card-title">What is AI Debate Coach?</h2>
          <p className="lp-card-desc">
            AI Debate Coach helps you train your debating skills with smart AI-generated
            arguments, counterpoints, and personalised feedback — improving your reasoning,
            confidence, and rhetorical precision one debate at a time.
          </p>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="lp-section">
        <div className="lp-card">
          <div className="lp-card-label">⚙️ Features</div>
          <h2 className="lp-card-title">Everything you need to win</h2>
          <div className="lp-features-grid">
            {[
              { icon: '⚖️', title: 'Pro & Con Generator', desc: 'Instantly generate balanced arguments on any topic.' },
              { icon: '🔄', title: 'Counter Rebuttal', desc: 'AI fires back with sharp, logical counterpoints.' },
              { icon: '🤖', title: 'AI Feedback', desc: 'Personalised performance feedback after every debate.' },
              { icon: '🎓', title: 'Practice Mode', desc: 'Train against AI opponents across difficulty levels.' },
              { icon: '🎙️', title: 'Voice Recognition', desc: 'Speak your arguments — we transcribe in real-time.' },
              { icon: '📊', title: 'Analytics', desc: 'Track your improvement with detailed debate analytics.' },
            ].map((f) => (
              <div key={f.title} className="lp-feature-box">
                <div className="lp-feature-icon">{f.icon}</div>
                <h3 className="lp-feature-title">{f.title}</h3>
                <p className="lp-feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* LIVE DEMO */}
      <section id="demo" className="lp-section">
        <div className="lp-card lp-card--demo">
          <div className="lp-card-label">🧠 Live Demo</div>
          <h2 className="lp-card-title">Analyse your argument in real-time</h2>
          <AnalysisDashboard onGetStarted={onGetStarted} showCTA={true} />
        </div>
      </section>

      {/* CONTACT */}
      <section id="contact" className="lp-section">
        <div className="lp-card">
          <div className="lp-card-label">📂 Contact</div>
          <h2 className="lp-card-title">Get in touch</h2>
          <div className="lp-contact-grid">
            <div className="lp-contact-item">
              <span className="lp-contact-icon">✉️</span>
              <span>debateai@email.com</span>
            </div>
            <div className="lp-contact-item">
              <span className="lp-contact-icon">🐙</span>
              <span>github.com/debatable</span>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <p>© 2026 <span className="lp-gradient-text">AI Debate Coach</span> · Designed with futuristic UI</p>
      </footer>
    </div>
  );
}

export default LandingPage;
