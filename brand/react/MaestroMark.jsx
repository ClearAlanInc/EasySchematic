// Maestro Connect — brand mark. Single source of truth for the app logo.
// <MaestroMark size={32} />            full mark, inherits color, orange core
// <MaestroMark size={16} />            auto-switches to the small cut (leads dropped)
// <MaestroMark variant="small" mono /> force the small cut, monochrome
// <MaestroLockup />                    mark + wordmark (needs IBM Plex Sans loaded)
// <MaestroAppIcon size={64} />         squircle app-icon tile

export const MC_INK = '#14181D';
export const MC_PAPER = '#F2F0EA';
export const MC_ORANGE = '#FF6A2B';       // on light backgrounds
export const MC_ORANGE_ON_DARK = '#FF8A4C'; // lifted for dark canvases

const strokeFor = (size, small) =>
  small ? (size <= 16 ? 2.6 : 2.3)
        : size >= 44 ? 1.5 : size >= 32 ? 1.8 : 2.0;

export function MaestroMark({
  size = 24,
  variant,                 // 'full' | 'small' — omit to pick by size
  mono = false,            // core inherits currentColor instead of orange
  core,                    // explicit core color; wins over mono
  strokeWidth,
  ...rest
}) {
  const small = (variant ?? (size < 24 ? 'small' : 'full')) === 'small';
  const coreColor = core ?? (mono || small ? 'currentColor' : MC_ORANGE);
  const sw = strokeWidth ?? strokeFor(size, small);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      role="img" aria-label="Maestro Connect" {...rest}>
      {small ? (
        <>
          <rect x="4.5" y="4.5" width="15" height="15" rx="1" />
          <rect x={size <= 16 ? 9.75 : 9.5} y={size <= 16 ? 9.75 : 9.5}
                width={size <= 16 ? 4.5 : 5} height={size <= 16 ? 4.5 : 5}
                fill={coreColor} stroke={coreColor} />
        </>
      ) : (
        <>
          <rect x="6" y="6" width="12" height="12" rx="0.8" />
          <rect x="9.5" y="9.5" width="5" height="5" fill={coreColor} stroke={coreColor} />
          <line x1="9.2" y1="2.6" x2="9.2" y2="6" />
          <line x1="14.8" y1="2.6" x2="14.8" y2="6" />
          <line x1="9.2" y1="18" x2="9.2" y2="21.4" />
          <line x1="14.8" y1="18" x2="14.8" y2="21.4" />
        </>
      )}
    </svg>
  );
}

export function MaestroLockup({ size = 42, onDark = false, ...rest }) {
  const ink = onDark ? MC_PAPER : MC_INK;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: size * 0.33, color: ink }} {...rest}>
      <MaestroMark size={size} core={onDark ? MC_ORANGE_ON_DARK : MC_ORANGE} />
      <span style={{
        font: `500 ${(size * 0.6).toFixed(1)}px/1 'IBM Plex Sans', system-ui, sans-serif`,
        letterSpacing: '-0.022em'
      }}>
        Maestro{' '}
        <span style={{ fontWeight: 400, color: onDark ? '#9A9DA2' : '#6E7278' }}>Connect</span>
      </span>
    </span>
  );
}

export function MaestroAppIcon({ size = 64, tone = 'dark', ...rest }) {
  const tones = {
    dark:     { bg: MC_INK,    ink: '#E8E6E1', core: MC_ORANGE_ON_DARK },
    light:    { bg: '#FFFFFF', ink: MC_INK,      core: MC_ORANGE },
    reversed: { bg: MC_ORANGE, ink: '#FFFFFF',   core: '#FFFFFF' },
    mono:     { bg: '#E7E4DC', ink: MC_INK,      core: MC_INK },
  }[tone];
  return (
    <span style={{
      width: size, height: size, borderRadius: size * 0.22, background: tones.bg,
      display: 'grid', placeItems: 'center', color: tones.ink, flex: 'none'
    }} {...rest}>
      <MaestroMark size={size * 0.62} core={tones.core} />
    </span>
  );
}
