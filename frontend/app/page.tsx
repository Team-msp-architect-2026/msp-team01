// frontend/app/page.tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LandingPage() {
  const router = useRouter()

  // 파티클 생성
  useEffect(() => {
    const container = document.getElementById('particles')
    if (!container) return
    const n = 28
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span')
      s.style.cssText = `
        position:absolute;
        width:2px;height:2px;border-radius:50%;
        left:${Math.random() * 100}%;
        top:${Math.random() * 100}%;
        animation-delay:${Math.random() * 9}s;
        animation-duration:${7 + Math.random() * 5}s;
        opacity:${0.3 + Math.random() * 0.5};
        animation-name:drift;
        animation-timing-function:linear;
        animation-iteration-count:infinite;
      `
      const isBlue = Math.random() > 0.6
      if (isBlue) {
        s.style.background = '#5aa3ff'
        s.style.boxShadow = '0 0 8px rgba(90,163,255,0.8)'
      } else if (Math.random() > 0.6) {
        s.style.background = '#ffa53d'
        s.style.boxShadow = '0 0 8px rgba(255,165,61,0.8)'
      } else {
        s.style.background = 'rgba(255,255,255,0.55)'
        s.style.boxShadow = '0 0 8px rgba(255,255,255,0.7)'
      }
      container.appendChild(s)
    }
    return () => { if (container) container.innerHTML = '' }
  }, [])

  // 스무스 스크롤
  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 60, behavior: 'smooth' })
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

        :root {
          --bg: #07090f;
          --bg-2: #0b0e16;
          --ink: #e7ebf3;
          --ink-dim: #8b93a7;
          --ink-mute: #4b5267;
          --line: rgba(255,255,255,0.06);
          --line-2: rgba(255,255,255,0.10);
          --orange: #ffa53d;
          --orange-deep: #f5871f;
          --blue: #5aa3ff;
          --blue-deep: #3d7eea;
          --display: 'Plus Jakarta Sans', -apple-system, sans-serif;
          --mono: 'JetBrains Mono', ui-monospace, monospace;
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
          background: var(--bg);
          color: var(--ink);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          -webkit-font-smoothing: antialiased;
          overflow-x: hidden;
        }
        a { color: inherit; text-decoration: none; }
        button { font-family: inherit; cursor: pointer; }

        /* NAV */
        .nav {
          position: fixed; inset: 0 0 auto 0;
          z-index: 60;
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px 36px;
          backdrop-filter: blur(14px) saturate(140%);
          background: linear-gradient(180deg, rgba(7,9,15,0.75) 0%, rgba(7,9,15,0.35) 80%, rgba(7,9,15,0));
        }
        .brand {
          display: flex; align-items: center; gap: 10px;
          font-family: var(--display);
          font-weight: 800; font-size: 17px; letter-spacing: -0.02em;
        }
        .brand-mark {
          width: 26px; height: 26px;
          display: grid; place-items: center;
          border-radius: 7px;
          background:
            radial-gradient(80% 80% at 30% 25%, rgba(255,165,61,0.7), transparent 60%),
            radial-gradient(80% 80% at 70% 80%, rgba(90,163,255,0.7), transparent 60%),
            #11151f;
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 4px 24px rgba(90,163,255,0.18), inset 0 0 12px rgba(255,255,255,0.06);
        }
        .brand-mark::after {
          content: ""; width: 9px; height: 9px;
          border-radius: 2px; background: #fff;
          box-shadow: 0 0 12px rgba(255,255,255,0.8);
        }
        .nav-links {
          display: flex; align-items: center; gap: 28px;
          font-size: 13px; color: var(--ink-dim); font-weight: 500;
        }
        .nav-links a { transition: color 160ms; }
        .nav-links a:hover { color: var(--ink); }
        .nav-cta { display: flex; gap: 10px; align-items: center; }
        .btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 9px 16px; font-size: 13px; font-weight: 600;
          border-radius: 8px; border: 1px solid var(--line-2);
          background: rgba(255,255,255,0.04); color: var(--ink);
          transition: background 160ms, border-color 160ms, transform 160ms;
          cursor: pointer;
        }
        .btn:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18); }
        .btn-primary { background: #f3f4f8; color: #0a0d14; border-color: #f3f4f8; }
        .btn-primary:hover { background: #fff; border-color: #fff; transform: translateY(-1px); }
        .btn .arrow { transition: transform 200ms; display: inline-block; }
        .btn:hover .arrow { transform: translateX(3px); }

        /* HERO */
        .hero {
          position: relative; height: 100vh; min-height: 720px;
          display: grid; place-items: center;
          overflow: hidden; isolation: isolate;
        }
        .grid-bg {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
          background-size: 56px 56px;
          mask-image: radial-gradient(ellipse 90% 70% at 50% 50%, #000 35%, transparent 75%);
          -webkit-mask-image: radial-gradient(ellipse 90% 70% at 50% 50%, #000 35%, transparent 75%);
          opacity: 0.55; z-index: 0;
        }
        .vignette {
          position: absolute; inset: 0;
          background: radial-gradient(ellipse 70% 60% at 50% 50%, transparent 0%, rgba(7,9,15,0.6) 70%, rgba(7,9,15,0.95) 100%);
          z-index: 1; pointer-events: none;
        }
        .orbit {
          position: absolute; top: 50%; left: 50%;
          width: min(640px, 60vw); aspect-ratio: 1;
          transform: translate(-50%, -50%);
          border-radius: 50%; border: 1px dashed rgba(255,255,255,0.08);
          z-index: 1; animation: spin 60s linear infinite;
        }
        .orbit::before, .orbit::after {
          content: ""; position: absolute;
          border-radius: 50%; border: 1px dashed rgba(255,255,255,0.06);
        }
        .orbit::before { inset: -50px; }
        .orbit::after  { inset: -110px; border-color: rgba(255,255,255,0.04); }
        @keyframes spin { to { transform: translate(-50%, -50%) rotate(360deg); } }

        .particles { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
        @keyframes drift {
          0%   { transform: translate(0, 20px); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translate(0, -120px); opacity: 0; }
        }

        .streams { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 2; pointer-events: none; }
        .stream-path {
          fill: none; stroke-linecap: round; filter: url(#glow);
          stroke-dasharray: 1400; stroke-dashoffset: 1400;
          animation: draw 2.4s 0.3s cubic-bezier(.22,.8,.18,1) forwards, flow 8s 3s linear infinite;
        }
        .stream-orange { stroke: var(--orange); stroke-width: 2.2; }
        .stream-orange-thin { stroke: var(--orange); stroke-width: 1; opacity: 0.55; }
        .stream-blue { stroke: var(--blue); stroke-width: 2.2; animation-delay: 0.5s, 3.2s; }
        .stream-blue-thin { stroke: var(--blue); stroke-width: 1; opacity: 0.55; animation-delay: 0.5s, 3.2s; }
        @keyframes draw { to { stroke-dashoffset: 0; } }
        @keyframes flow {
          0%   { stroke-dasharray: 12 28; stroke-dashoffset: 0; }
          100% { stroke-dasharray: 12 28; stroke-dashoffset: -160; }
        }

        .hero-inner { position: relative; z-index: 5; text-align: center; padding: 0 24px; }
        .eyebrow {
          display: inline-flex; align-items: center; gap: 10px;
          font-family: var(--mono); font-size: 11.5px; font-weight: 500;
          letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-dim);
          padding: 7px 14px; border: 1px solid var(--line-2); border-radius: 100px;
          background: rgba(255,255,255,0.03); margin-bottom: 36px;
          opacity: 0; animation: rise 800ms 100ms cubic-bezier(.22,.8,.18,1) forwards;
        }
        .eyebrow .dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #6ee7a0; box-shadow: 0 0 8px #6ee7a0;
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }

        .wordmark {
          font-family: var(--display); font-weight: 800;
          font-size: clamp(72px, 14vw, 200px);
          line-height: 0.95; letter-spacing: -0.045em;
          margin: 0; color: #fff;
          text-shadow: 0 0 30px rgba(255,255,255,0.35), 0 0 80px rgba(255,255,255,0.22), 0 0 160px rgba(90,163,255,0.18);
          opacity: 0; animation: glowIn 1400ms 300ms cubic-bezier(.22,.8,.18,1) forwards;
        }
        @keyframes glowIn {
          0%   { opacity: 0; letter-spacing: 0.04em; filter: blur(20px); }
          60%  { opacity: 1; }
          100% { opacity: 1; letter-spacing: -0.045em; filter: blur(0); }
        }

        .tagline {
          margin: 28px auto 0;
          font-size: clamp(15px, 1.4vw, 19px); color: var(--ink-dim);
          font-weight: 500; letter-spacing: -0.01em; line-height: 1.6;
          max-width: 560px;
          opacity: 0; animation: rise 800ms 900ms cubic-bezier(.22,.8,.18,1) forwards;
        }
        .tagline strong { color: var(--ink); font-weight: 600; }

        .hero-cta {
          display: flex; gap: 12px; justify-content: center; margin-top: 40px;
          opacity: 0; animation: rise 800ms 1100ms cubic-bezier(.22,.8,.18,1) forwards;
        }
        .hero-cta .btn { padding: 12px 20px; font-size: 14px; }

        @keyframes rise {
          0%   { opacity: 0; transform: translateY(14px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        .corner {
          position: absolute; z-index: 5;
          font-family: var(--mono); font-size: 12px; font-weight: 500;
          letter-spacing: 0.02em; display: flex; align-items: center; gap: 10px;
          opacity: 0; animation: rise 900ms 1500ms cubic-bezier(.22,.8,.18,1) forwards;
        }
        .corner .pip { width: 7px; height: 7px; border-radius: 50%; box-shadow: 0 0 10px currentColor; }
        .corner-tr { top: 90px; right: 36px; color: var(--blue); }
        .corner-bl { bottom: 32px; left: 36px; color: var(--orange); }
        .corner-br { bottom: 32px; right: 36px; color: var(--ink-mute); font-weight: 400; letter-spacing: 0.1em; }

        .scroll-hint {
          position: absolute; bottom: 28px; left: 50%; transform: translateX(-50%);
          z-index: 5; font-family: var(--mono); font-size: 10.5px;
          letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-mute);
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          opacity: 0; animation: rise 900ms 1800ms cubic-bezier(.22,.8,.18,1) forwards;
        }
        .scroll-hint .line {
          width: 1px; height: 28px;
          background: linear-gradient(180deg, rgba(255,255,255,0.4), transparent);
          animation: drop 2s ease-in-out infinite;
        }
        @keyframes drop {
          0%, 100% { transform: scaleY(1); transform-origin: top; opacity: 0.4; }
          50% { transform: scaleY(1.4); opacity: 1; }
        }

        /* SECTION */
        .section { position: relative; padding: 140px 36px; max-width: 1200px; margin: 0 auto; }
        .section-head { margin-bottom: 64px; max-width: 720px; }
        .section-tag {
          font-family: var(--mono); font-size: 11.5px; font-weight: 500;
          letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-mute);
          display: inline-flex; align-items: center; gap: 10px; margin-bottom: 18px;
        }
        .section-tag::before { content: ""; width: 18px; height: 1px; background: currentColor; }
        .section-title {
          font-family: var(--display); font-size: clamp(32px, 4vw, 52px);
          font-weight: 700; line-height: 1.1; letter-spacing: -0.03em;
          margin: 0 0 18px; color: var(--ink);
        }
        .section-sub { font-size: 16px; color: var(--ink-dim); line-height: 1.65; max-width: 560px; margin: 0; }

        /* CAP GRID */
        .cap-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
        .cap {
          position: relative; padding: 32px; border-radius: 16px;
          border: 1px solid var(--line);
          background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01));
          transition: border-color 220ms, transform 220ms;
          overflow: hidden; min-height: 320px;
          display: flex; flex-direction: column;
        }
        .cap:hover { border-color: var(--line-2); transform: translateY(-2px); }
        .cap::before {
          content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, var(--accent, #fff), transparent);
          opacity: 0.5;
        }
        .cap[data-accent="orange"] { --accent: var(--orange); }
        .cap[data-accent="blue"]   { --accent: var(--blue); }
        .cap[data-accent="white"]  { --accent: rgba(255,255,255,0.4); }
        .cap-icon {
          width: 40px; height: 40px; border-radius: 10px;
          background: rgba(255,255,255,0.03); border: 1px solid var(--line-2);
          display: grid; place-items: center; margin-bottom: 22px;
          color: var(--accent); font-family: var(--mono); font-size: 16px; font-weight: 600;
        }
        .cap-label { font-family: var(--mono); font-size: 11px; font-weight: 500; letter-spacing: 0.15em; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; }
        .cap-name { font-family: var(--display); font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: var(--ink); margin: 0 0 12px; }
        .cap-desc { font-size: 14px; color: var(--ink-dim); line-height: 1.65; margin: 0 0 22px; }
        .cap-meta {
          margin-top: auto; display: flex; flex-direction: column; gap: 6px;
          padding-top: 18px; border-top: 1px dashed var(--line);
          font-family: var(--mono); font-size: 11.5px; color: var(--ink-mute);
        }
        .cap-meta div { display: flex; justify-content: space-between; }
        .cap-meta span:last-child { color: var(--ink-dim); }

        /* FLOW */
        .flow-section { background: linear-gradient(180deg, transparent, rgba(255,255,255,0.015), transparent); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
        .flow { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0; position: relative; margin-top: 32px; }
        .flow-step {
          position: relative; padding: 28px 18px; border-right: 1px dashed var(--line);
          text-align: center; transition: background 200ms;
        }
        .flow-step:last-child { border-right: none; }
        .flow-step:hover { background: rgba(255,255,255,0.02); }
        .flow-num { font-family: var(--mono); font-size: 10.5px; color: var(--ink-mute); letter-spacing: 0.18em; margin-bottom: 10px; }
        .flow-glyph {
          width: 44px; height: 44px; margin: 0 auto 16px; border-radius: 12px;
          background: rgba(255,255,255,0.03); border: 1px solid var(--line-2);
          display: grid; place-items: center; color: var(--ink);
        }
        .flow-step[data-tone="orange"] .flow-glyph { color: var(--orange); border-color: rgba(255,165,61,0.25); background: rgba(255,165,61,0.05); }
        .flow-step[data-tone="blue"]   .flow-glyph { color: var(--blue);   border-color: rgba(90,163,255,0.25);  background: rgba(90,163,255,0.06); }
        .flow-name { font-family: var(--display); font-weight: 700; font-size: 14px; letter-spacing: -0.01em; color: var(--ink); margin-bottom: 4px; }
        .flow-sub  { font-family: var(--mono); font-size: 10.5px; color: var(--ink-mute); letter-spacing: 0.05em; }

        /* SPLIT */
        .split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
        .cloud {
          position: relative; padding: 40px 32px; border-radius: 18px;
          border: 1px solid var(--line);
          background: linear-gradient(180deg, rgba(255,255,255,0.02), transparent);
          overflow: hidden; min-height: 360px;
        }
        .cloud-orange {
          background: radial-gradient(ellipse 60% 50% at 100% 0%, rgba(255,165,61,0.10), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), transparent);
          border-color: rgba(255,165,61,0.18);
        }
        .cloud-blue {
          background: radial-gradient(ellipse 60% 50% at 0% 0%, rgba(90,163,255,0.10), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), transparent);
          border-color: rgba(90,163,255,0.18);
        }
        .cloud-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
        .cloud-badge { font-family: var(--mono); font-size: 11px; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase; padding: 6px 12px; border-radius: 100px; border: 1px solid; }
        .cloud-orange .cloud-badge { color: var(--orange); border-color: rgba(255,165,61,0.3); background: rgba(255,165,61,0.06); }
        .cloud-blue   .cloud-badge { color: var(--blue);   border-color: rgba(90,163,255,0.3);  background: rgba(90,163,255,0.06); }
        .cloud-status { font-family: var(--mono); font-size: 11.5px; color: var(--ink-dim); display: flex; align-items: center; gap: 8px; }
        .cloud-status .pip { width: 7px; height: 7px; border-radius: 50%; background: #6ee7a0; box-shadow: 0 0 10px #6ee7a0; animation: pulse 2s ease-in-out infinite; }
        .cloud-status.standby .pip { background: var(--blue); box-shadow: 0 0 10px var(--blue); }
        .cloud-title { font-family: var(--display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 8px; }
        .cloud-desc { color: var(--ink-dim); font-size: 14px; line-height: 1.65; margin: 0 0 28px; max-width: 380px; }
        .cloud-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; padding-top: 24px; border-top: 1px dashed var(--line); }
        .cloud-stat .label { font-family: var(--mono); font-size: 10.5px; color: var(--ink-mute); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 6px; }
        .cloud-stat .value { font-family: var(--display); font-size: 22px; font-weight: 700; color: var(--ink); letter-spacing: -0.02em; }
        .cloud-stat .value small { font-size: 12px; color: var(--ink-mute); font-weight: 500; margin-left: 3px; }

        /* TERMINAL */
        .showcase { margin-top: 56px; border: 1px solid var(--line); border-radius: 16px; background: linear-gradient(180deg, #0a0d14, #07090f); overflow: hidden; }
        .term-bar { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--line); background: rgba(255,255,255,0.015); }
        .term-bar .dots { display: flex; gap: 6px; }
        .term-bar .dots span { width: 11px; height: 11px; border-radius: 50%; background: rgba(255,255,255,0.1); }
        .term-bar .title { font-family: var(--mono); font-size: 12px; color: var(--ink-mute); margin-left: 8px; }
        .term-bar .status { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--ink-mute); display: flex; align-items: center; gap: 8px; }
        .term-bar .status .pip { width: 6px; height: 6px; border-radius: 50%; background: #6ee7a0; box-shadow: 0 0 8px #6ee7a0; animation: pulse 2s ease-in-out infinite; }
        .term-body { padding: 28px 28px 32px; font-family: var(--mono); font-size: 13.5px; line-height: 1.85; color: var(--ink); }
        .term-line { display: flex; gap: 12px; }
        .term-line .prompt { color: var(--orange); flex-shrink: 0; }
        .term-line.user .text { color: var(--ink); }
        .term-line.sys .prompt { color: var(--ink-mute); }
        .term-line.sys .text { color: var(--ink-dim); }
        .term-line.ok .prompt  { color: #6ee7a0; }
        .term-line.ok .text    { color: var(--ink-dim); }
        .term-line.blue .prompt { color: var(--blue); }
        .term-line.blue .text   { color: var(--ink-dim); }
        .caret { display: inline-block; width: 7px; height: 1em; background: var(--ink); vertical-align: -2px; margin-left: 4px; animation: blink 1s steps(2) infinite; }
        @keyframes blink { 50% { opacity: 0; } }

        /* CTA */
        .cta-strip { position: relative; padding: 120px 36px; text-align: center; overflow: hidden; }
        .cta-strip::before {
          content: ""; position: absolute; inset: 0;
          background: radial-gradient(ellipse 50% 70% at 20% 50%, rgba(255,165,61,0.10), transparent 60%), radial-gradient(ellipse 50% 70% at 80% 50%, rgba(90,163,255,0.10), transparent 60%);
          pointer-events: none;
        }
        .cta-strip h2 { font-family: var(--display); font-size: clamp(34px, 5vw, 64px); font-weight: 800; line-height: 1.05; letter-spacing: -0.035em; margin: 0 auto 20px; max-width: 820px; color: #fff; position: relative; }
        .cta-strip p { color: var(--ink-dim); font-size: 16px; line-height: 1.6; max-width: 520px; margin: 0 auto 36px; position: relative; }
        .cta-strip .btns { display: flex; gap: 12px; justify-content: center; position: relative; }
        .cta-strip .btn { padding: 13px 22px; font-size: 14px; }

        /* FOOTER */
        footer { padding: 48px 36px 56px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: flex-start; gap: 32px; flex-wrap: wrap; max-width: 1200px; margin: 0 auto; }
        .foot-brand { display: flex; flex-direction: column; gap: 12px; }
        .foot-brand .brand { font-size: 16px; }
        .foot-brand .copy { font-family: var(--mono); font-size: 11.5px; color: var(--ink-mute); letter-spacing: 0.04em; }
        .foot-cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 48px; }
        .foot-col h4 { font-family: var(--mono); font-size: 10.5px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-mute); margin: 0 0 14px; }
        .foot-col ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .foot-col a { font-size: 13px; color: var(--ink-dim); transition: color 160ms; }
        .foot-col a:hover { color: var(--ink); }

        @media (max-width: 980px) {
          .nav-links { display: none; }
          .cap-grid { grid-template-columns: 1fr; }
          .flow { grid-template-columns: repeat(2, 1fr); }
          .flow-step { border-right: 1px dashed var(--line); border-bottom: 1px dashed var(--line); }
          .flow-step:nth-child(2n) { border-right: none; }
          .split { grid-template-columns: 1fr; }
          .foot-cols { grid-template-columns: 1fr 1fr; gap: 28px; }
          .corner-bl, .corner-tr { font-size: 10.5px; }
          .corner-tr { top: 80px; right: 18px; }
          .corner-bl { bottom: 18px; left: 18px; }
          .corner-br { display: none; }
          .section { padding: 90px 24px; }
        }
      `}</style>

      {/* NAV */}
      <nav className="nav">
        <a className="brand" href="#top">
          <span className="brand-mark"></span>
          AutoOps
        </a>
        <div className="nav-links">
          <a href="#platform" onClick={(e) => { e.preventDefault(); scrollTo('platform') }}>플랫폼</a>
          <a href="#flow" onClick={(e) => { e.preventDefault(); scrollTo('flow') }}>동작 방식</a>
          <a href="#cloud" onClick={(e) => { e.preventDefault(); scrollTo('cloud') }}>듀얼 클라우드</a>
        </div>
        <div className="nav-cta">
          <button className="btn" onClick={() => router.push('/login')}>로그인</button>
          <button className="btn btn-primary" onClick={() => router.push('/signup')}>
            시작하기 <span className="arrow">→</span>
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero" id="top">
        <div className="grid-bg"></div>
        <div className="orbit"></div>
        <div className="particles" id="particles"></div>

        <svg className="streams" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path className="stream-path stream-orange" d="M -50 760 C 220 700, 380 640, 620 540 S 1050 380, 1300 360" />
          <path className="stream-path stream-orange-thin" d="M -80 820 C 260 780, 480 720, 700 600 S 1100 460, 1380 440" />
          <path className="stream-path stream-blue" d="M 1650 140 C 1380 200, 1220 260, 980 360 S 550 520, 300 540" />
          <path className="stream-path stream-blue-thin" d="M 1680 80 C 1340 120, 1120 180, 900 300 S 500 440, 220 460" />
        </svg>

        <div className="vignette"></div>

        <div className="corner corner-br">Made By 뚝딱</div>

        <div className="hero-inner">
          <div className="eyebrow">
            <span className="dot"></span>
            Automated · Intelligent · Resilient
          </div>
          <h1 className="wordmark">AutoOps</h1>
          <p className="tagline">
            인프라를 만드는 순간,<br />
            <strong>재해 대비도 함께 시작된다.</strong>
          </p>
          <div className="hero-cta">
            <button className="btn btn-primary" onClick={() => router.push('/signup')}>
              무료로 시작하기 <span className="arrow">→</span>
            </button>
            <button className="btn" onClick={() => scrollTo('flow')}>
              동작 방식 보기
            </button>
          </div>
        </div>

        <div className="scroll-hint">
          <span>Scroll</span>
          <span className="line"></span>
        </div>
      </section>

      {/* CAPABILITIES */}
      <section className="section" id="platform">
        <div className="section-head">
          <div className="section-tag">Platform</div>
          <h2 className="section-title">
            자연어 한 줄로<br />
            <em style={{ fontStyle: 'normal', color: 'var(--ink-dim)' }}>멀티 클라우드 인프라를 짜는 방법.</em>
          </h2>
          <p className="section-sub">
            AutoOps는 프롬프트 입력 → AWS 자동 배포 → GCP DR 미러링까지를 하나의 파이프라인으로 묶었습니다. 세 개의 코어 엔진이 그 위에서 동작합니다.
          </p>
        </div>

        <div className="cap-grid">
          <div className="cap" data-accent="orange">
            <div className="cap-icon">◇</div>
            <div className="cap-label">CraftOps</div>
            <h3 className="cap-name">AI Provisioning Engine</h3>
            <p className="cap-desc">
              자연어 프롬프트를 Terraform 코드로 변환하고, AWS 환경에 즉시 배포합니다. VPC · ECS · RDS · ALB 까지 한 번에.
            </p>
            <div className="cap-meta">
              <div><span>Target</span><span>AWS</span></div>
              <div><span>Output</span><span>Terraform 1.7+</span></div>
              <div><span>AI</span><span>Gemini API</span></div>
            </div>
          </div>

          <div className="cap" data-accent="blue">
            <div className="cap-icon">◈</div>
            <div className="cap-label">MirrorOps</div>
            <h3 className="cap-name">DR Mirroring Engine</h3>
            <p className="cap-desc">
              배포 직후 동일 구성을 GCP Standby로 코드화합니다. Warm Standby 전략으로 비용은 최소화, RTO는 15분 이내.
            </p>
            <div className="cap-meta">
              <div><span>Target</span><span>GCP</span></div>
              <div><span>Mode</span><span>Warm Standby</span></div>
              <div><span>RTO / RPO</span><span>15min / 3min</span></div>
            </div>
          </div>

          <div className="cap" data-accent="white">
            <div className="cap-icon">◉</div>
            <div className="cap-label">Validation Loop</div>
            <h3 className="cap-name">4-Stage Verifier</h3>
            <p className="cap-desc">
              validate → 보안 스캔 → 비용 예측 → plan 4단계 검증을 자동 수행합니다. Self-Correction으로 오류를 자동 수정.
            </p>
            <div className="cap-meta">
              <div><span>Stages</span><span>4</span></div>
              <div><span>Security</span><span>tfsec + checkov</span></div>
              <div><span>Cost</span><span>Infracost</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* FLOW */}
      <section className="flow-section" id="flow">
        <div className="section">
          <div className="section-head">
            <div className="section-tag">End-to-End Flow</div>
            <h2 className="section-title">한 줄 입력에서 DR 패키지까지.</h2>
            <p className="section-sub">
              프롬프트 입력부터 GCP 스탠바이 환경 미러링까지 6단계. 모두 백그라운드에서 자동으로 일어납니다.
            </p>
          </div>

          <div className="flow">
            {[
              { n: '01', tone: '', name: '프롬프트 입력', sub: 'Natural language', icon: <path d="M3 12h18M3 6h18M3 18h12" strokeWidth="1.6" stroke="currentColor" fill="none" strokeLinecap="round"/> },
              { n: '02', tone: 'orange', name: '인프라 설계', sub: 'CraftOps · IaC', icon: <><rect x="3" y="3" width="7" height="7" rx="1" strokeWidth="1.6" stroke="currentColor" fill="none"/><rect x="14" y="3" width="7" height="7" rx="1" strokeWidth="1.6" stroke="currentColor" fill="none"/><rect x="3" y="14" width="7" height="7" rx="1" strokeWidth="1.6" stroke="currentColor" fill="none"/><rect x="14" y="14" width="7" height="7" rx="1" strokeWidth="1.6" stroke="currentColor" fill="none"/></> },
              { n: '03', tone: '', name: 'Validation', sub: '4-stage check', icon: <><path d="M9 11l3 3 7-7" strokeWidth="1.6" stroke="currentColor" fill="none" strokeLinecap="round"/><path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9" strokeWidth="1.6" stroke="currentColor" fill="none"/></> },
              { n: '04', tone: 'orange', name: 'AWS 배포', sub: 'terraform apply', icon: <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" strokeWidth="1.6" stroke="currentColor" fill="none" strokeLinejoin="round"/> },
              { n: '05', tone: 'blue', name: 'GCP 미러링', sub: 'MirrorOps', icon: <><path d="M3 12a9 9 0 1 0 18 0M3 12a9 9 0 1 1 18 0" strokeWidth="1.6" stroke="currentColor" fill="none"/><path d="M3 12h18M12 3v18" strokeWidth="1.6" stroke="currentColor" fill="none"/></> },
              { n: '06', tone: 'blue', name: 'DR Package', sub: 'Standby ready', icon: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" strokeWidth="1.6" stroke="currentColor" fill="none"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" strokeWidth="1.6" stroke="currentColor" fill="none"/></> },
            ].map((step) => (
              <div key={step.n} className="flow-step" data-tone={step.tone || undefined}>
                <div className="flow-num">{step.n}</div>
                <div className="flow-glyph">
                  <svg width="20" height="20" viewBox="0 0 24 24">{step.icon}</svg>
                </div>
                <div className="flow-name">{step.name}</div>
                <div className="flow-sub">{step.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DUAL CLOUD */}
      <section className="section" id="cloud">
        <div className="section-head">
          <div className="section-tag">Dual Cloud</div>
          <h2 className="section-title">하나의 코드, 두 개의 클라우드.</h2>
          <p className="section-sub">
            AWS에 인프라를 만드는 그 순간, GCP에는 같은 형태의 스탠바이 환경이 IaC로 동기화됩니다. 장애 발생 시 단일 명령으로 트래픽이 넘어갑니다.
          </p>
        </div>

        <div className="split">
          <div className="cloud cloud-orange">
            <div className="cloud-head">
              <span className="cloud-badge">CraftOps · AWS</span>
              <span className="cloud-status">
                <span className="pip"></span> Active · us-west-2
              </span>
            </div>
            <h3 className="cloud-title">Primary Production</h3>
            <p className="cloud-desc">
              실제 트래픽이 흐르는 메인 환경. CraftOps 엔진이 자연어에서 Terraform을 만들고 그대로 배포합니다. 16개 리소스 3-Tier 망분리 아키텍처 기본 제공.
            </p>
            <div className="cloud-stats">
              <div className="cloud-stat"><div className="label">Resources</div><div className="value">16</div></div>
              <div className="cloud-stat"><div className="label">Arch</div><div className="value" style={{ fontSize: 16 }}>3-Tier</div></div>
              <div className="cloud-stat"><div className="label">IaC</div><div className="value" style={{ fontSize: 16 }}>TF<small>1.7</small></div></div>
            </div>
          </div>

          <div className="cloud cloud-blue">
            <div className="cloud-head">
              <span className="cloud-badge">MirrorOps · GCP</span>
              <span className="cloud-status standby">
                <span className="pip"></span> Standby · us-west1
              </span>
            </div>
            <h3 className="cloud-title">Disaster Recovery</h3>
            <p className="cloud-desc">
              AWS 배포 직후 자동 생성되는 미러 환경. 코드로만 살아있다가 장애 시 즉시 구동. AWS Control Plane 전역 장애에도 독립적으로 작동합니다.
            </p>
            <div className="cloud-stats">
              <div className="cloud-stat"><div className="label">Resources</div><div className="value">11</div></div>
              <div className="cloud-stat"><div className="label">RTO</div><div className="value">15<small>min</small></div></div>
              <div className="cloud-stat"><div className="label">RPO</div><div className="value">3<small>min</small></div></div>
            </div>
          </div>
        </div>

        {/* TERMINAL */}
        <div className="showcase">
          <div className="term-bar">
            <div className="dots"><span></span><span></span><span></span></div>
            <span className="title">autoops · prompt session</span>
            <span className="status"><span className="pip"></span> live</span>
          </div>
          <div className="term-body">
            <div className="term-line user"><span className="prompt">›</span><span className="text">프로덕션용 FastAPI 서버 + PostgreSQL 15, 금융보안 3-Tier 망분리, 오레곤 리전, 오토스케일링 포함해줘.</span></div>
            <div className="term-line sys"><span className="prompt">·</span><span className="text">parsing intent · matched template: web-api-stack · 16 resources</span></div>
            <div className="term-line sys"><span className="prompt">·</span><span className="text">drafting terraform — VPC · ECS Fargate · RDS PostgreSQL · ALB</span></div>
            <div className="term-line ok"><span className="prompt">✓</span><span className="text">validation passed — terraform validate · tfsec · checkov · infracost</span></div>
            <div className="term-line ok"><span className="prompt">✓</span><span className="text">aws apply complete — us-west-2 · 16 resources created</span></div>
            <div className="term-line blue"><span className="prompt">↻</span><span className="text">mirroring to gcp standby — EventBridge triggered · MirrorOps running</span></div>
            <div className="term-line blue"><span className="prompt">✓</span><span className="text">dr package sealed — 11 resources · warm standby · RTO 15min<span className="caret"></span></span></div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-strip" id="start">
        <h2>인프라부터 DR까지,<br />하나의 줄로 끝.</h2>
        <p>가입하고 첫 프롬프트를 입력하면 AWS · GCP 듀얼 환경이 자동으로 준비됩니다.</p>
        <div className="btns">
          <button className="btn btn-primary" onClick={() => router.push('/signup')}>
            무료로 시작하기 <span className="arrow">→</span>
          </button>
          <button className="btn" onClick={() => router.push('/login')}>로그인</button>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="foot-brand">
          <div className="brand">
            <span className="brand-mark"></span>
            AutoOps
          </div>
          <div className="copy">© 2026 AutoOps · Made By 뚝딱</div>
        </div>
        <div className="foot-cols">
          <div className="foot-col">
            <h4>Platform</h4>
            <ul>
              <li><a href="#platform" onClick={(e) => { e.preventDefault(); scrollTo('platform') }}>CraftOps</a></li>
              <li><a href="#platform" onClick={(e) => { e.preventDefault(); scrollTo('platform') }}>MirrorOps</a></li>
              <li><a href="#platform" onClick={(e) => { e.preventDefault(); scrollTo('platform') }}>Validation Loop</a></li>
            </ul>
          </div>
          <div className="foot-col">
            <h4>Flow</h4>
            <ul>
              <li><a href="#flow" onClick={(e) => { e.preventDefault(); scrollTo('flow') }}>동작 방식</a></li>
              <li><a href="#cloud" onClick={(e) => { e.preventDefault(); scrollTo('cloud') }}>듀얼 클라우드</a></li>
            </ul>
          </div>
          <div className="foot-col">
            <h4>Account</h4>
            <ul>
              <li><a href="#" onClick={(e) => { e.preventDefault(); router.push('/login') }}>로그인</a></li>
              <li><a href="#" onClick={(e) => { e.preventDefault(); router.push('/signup') }}>회원가입</a></li>
            </ul>
          </div>
        </div>
      </footer>
    </>
  )
}