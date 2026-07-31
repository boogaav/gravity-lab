import { actions } from '../state/store';
import { thumbUrl, type WorldCard } from '../state/api';
import { YEAR } from '../physics/constants';

export function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function fate(w: WorldCard): { label: string; cls: string; tip: string } {
  if (w.firstCollision != null) {
    return {
      label: `impact at ${(w.firstCollision / YEAR).toPrecision(2)} yr`,
      cls: 'fate-impact',
      tip: 'Two bodies actually touched at this simulated time, measured by running the world forward with real collision radii.',
    };
  }
  if (w.escapees > 0) {
    return {
      label: `${w.escapees} ejected`,
      cls: 'fate-eject',
      tip: 'This many bodies ended on unbound trajectories — gravity slingshot them out of the system for good.',
    };
  }
  return { label: 'intact', cls: 'fate-intact', tip: 'No collisions and nothing ejected over the simulated horizon: a system that holds together.' };
}

function chaosLabel(w: WorldCard): { label: string; cls: string; tip: string } {
  const tip =
    'Lyapunov exponent per orbit: the world is run alongside a twin displaced by one part in a billion, and this is how fast the two diverge. Near 0 means predictable; above 0.3 means tiny differences explode.';
  if (w.chaosWindow <= 0) {
    return { label: 'unmeasured', cls: 'chaos-none', tip: 'The world collided or merged before a full orbit elapsed, so no meaningful chaos value could be measured.' };
  }
  if (w.chaos > 0.3) return { label: `chaotic ${w.chaos.toFixed(2)}`, cls: 'chaos-high', tip };
  if (w.chaos > 0.1) return { label: `unsettled ${w.chaos.toFixed(2)}`, cls: 'chaos-mid', tip };
  return { label: `regular ${w.chaos.toFixed(2)}`, cls: 'chaos-low', tip };
}

function Card({ w }: { w: WorldCard }) {
  const f = fate(w);
  const c = chaosLabel(w);
  return (
    <a
      className="world-card"
      href={actions.routePath({ kind: 'world', slug: w.slug })}
      data-tip-title={w.title}
      data-tip="Open this world — it loads the author's exact initial conditions and runs them live in your browser."
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        actions.navigate({ kind: 'world', slug: w.slug });
      }}
    >
      <div className="world-thumb">
        {w.hasThumb ? (
          <img src={thumbUrl(w.slug)} alt="" loading="lazy" />
        ) : (
          <div className="world-thumb-empty">no preview</div>
        )}
        <span className="world-bodies">{w.bodies} bodies</span>
      </div>
      <div className="world-card-body">
        <div className="world-title">{w.title}</div>
        <div className="world-meta">
          @{w.slug}
          {w.ownerHandle ? (
            <>
              {' · '}
              <span
                className="creator-link"
                data-tip-title={`@${w.ownerHandle}`}
                data-tip="See every world published by this creator."
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  actions.navigate({ kind: 'creator', handle: w.ownerHandle! });
                }}
              >
                @{w.ownerHandle}
              </span>
            </>
          ) : (
            w.author && <> · {w.author}</>
          )}
          {' · '}
          {timeAgo(w.createdAt)}
        </div>
        <div className="world-chips">
          <span className={`wchip ${f.cls}`} data-tip-title="Fate" data-tip={f.tip}>{f.label}</span>
          <span className={`wchip ${c.cls}`} data-tip-title="Chaos" data-tip={c.tip}>{c.label}</span>
          <span className="wchip" data-tip-title="Likes" data-tip="How many visitors liked this world.">♥ {w.likes}</span>
          <span className="wchip" data-tip-title="Views" data-tip="How many times this world has been opened.">{w.views} views</span>
        </div>
      </div>
    </a>
  );
}

export default function WorldGrid({ worlds }: { worlds: WorldCard[] }) {
  return (
    <div className="world-grid">
      {worlds.map((w) => (
        <Card key={w.slug} w={w} />
      ))}
    </div>
  );
}
