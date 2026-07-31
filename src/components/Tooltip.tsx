import { useEffect, useRef, useState } from 'react';

/**
 * One global tooltip driven by data attributes, so any control can explain
 * itself without wrapping it in a component:
 *
 *   <button data-tip-title="Publish" data-tip="What it does and how it works.">
 *
 * Hover (or keyboard focus) shows the popup; it is positioned to stay on
 * screen and never blocks the pointer.
 */
interface TipState {
  title: string;
  body: string;
  x: number;
  y: number;
  below: boolean;
}

const SHOW_DELAY_MS = 260;

export default function Tooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const timer = useRef<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
    const hide = () => {
      clear();
      setTip(null);
    };

    const show = (el: HTMLElement) => {
      const body = el.getAttribute('data-tip');
      if (!body) return;
      const title = el.getAttribute('data-tip-title') ?? '';
      const r = el.getBoundingClientRect();
      // prefer above the control; flip below when there is no room
      const below = r.top < 130;
      setTip({
        title,
        body,
        x: Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140),
        y: below ? r.bottom + 10 : r.top - 10,
        below,
      });
    };

    const onOver = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (!el) return;
      clear();
      timer.current = window.setTimeout(() => show(el), SHOW_DELAY_MS);
    };
    const onOut = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]');
      if (el) hide();
    };

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('focusin', onOver, true);
    document.addEventListener('focusout', onOut, true);
    // any interaction or scroll dismisses it
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      clear();
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('focusin', onOver, true);
      document.removeEventListener('focusout', onOut, true);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tip) return null;

  return (
    <div
      ref={boxRef}
      className={`tip ${tip.below ? 'tip-below' : 'tip-above'}`}
      style={{ left: tip.x, top: tip.y }}
      role="tooltip"
    >
      {tip.title && <div className="tip-title">{tip.title}</div>}
      <div className="tip-body">{tip.body}</div>
    </div>
  );
}
