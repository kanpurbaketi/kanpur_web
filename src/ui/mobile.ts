import { t, onLang } from '../i18n';

/*
 Phones and tablets: the game is laid out for a screen held sideways (index.html's touch styles). Here:
 - `body.touch` on touch screens, so the HUD and the messages can tell (`isTouch`);
 - held upright, a card asks for the phone to be turned (it goes once it is; "Play upright anyway" keeps it away for
   the visit);
 - the first tap asks for fullscreen and the screen locked sideways, where the browser allows it (Android's Chrome
   does; an iPhone's Safari does neither, and the card does the asking there).
*/

export const isTouch = matchMedia('(pointer: coarse)').matches;

const KEY = 'ramu.portraitOk';

export function setupMobile(): void {
  if (!isTouch) return;
  document.body.classList.add('touch');

  const card = document.createElement('div');
  card.className = 'rotate';
  card.innerHTML = `<div class="rotate-card">
    <svg class="rotate-icon" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="20" y="8" width="24" height="44" rx="4" fill="none" stroke="currentColor" stroke-width="3"/>
      <path d="M8 40 A24 24 0 0 0 30 58" fill="none" stroke="#f2992a" stroke-width="3" stroke-linecap="round"/>
      <path d="M24 54 L31 58 L27 51" fill="none" stroke="#f2992a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <h2 class="rotate-title"></h2>
    <p class="rotate-sub"></p>
    <button type="button" class="rotate-anyway"></button>
  </div>`;
  document.body.append(card);
  const draw = () => {
    card.querySelector('.rotate-title')!.textContent = t('rotate.title');
    card.querySelector('.rotate-sub')!.textContent = t('rotate.sub');
    card.querySelector('.rotate-anyway')!.textContent = t('rotate.anyway');
  };
  draw();
  onLang(draw);

  let ok = false;
  try { ok = sessionStorage.getItem(KEY) === '1'; } catch { /* private window */ }
  const upright = matchMedia('(orientation: portrait)');
  const show = () => card.classList.toggle('on', upright.matches && !ok);
  show();
  upright.addEventListener('change', show);
  card.querySelector('.rotate-anyway')!.addEventListener('click', () => {
    ok = true;
    try { sessionStorage.setItem(KEY, '1'); } catch { /* private window */ }
    show();
  });

  // full screen, sideways. Browsers allow it only from a tap, so it is asked on every tap until it holds (and again
  // after it is left), and a button asks for it too. An iPhone's Safari has no full screen for pages at all: there the
  // game added to the Home Screen opens without the address bar (public/manifest.webmanifest), and a card says how, once
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const canFull = !!(el.requestFullscreen || el.webkitRequestFullscreen) && (document.fullscreenEnabled ?? true);
  const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const isFull = () => !!(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement);
  const goFull = () => {
    if (standalone || !canFull || isFull()) return;
    try {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : (el.webkitRequestFullscreen?.(), Promise.resolve());
      void p.then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => { /* not allowed now: the next tap asks again */ });
    } catch { /* not allowed */ }
  };
  if (canFull && !standalone) {
    addEventListener('touchend', goFull, { capture: true });
    const fs = document.createElement('button');
    fs.type = 'button';
    fs.className = 'fs-btn';
    fs.setAttribute('aria-label', 'Full screen');
    fs.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    fs.addEventListener('click', goFull);
    document.body.append(fs);
    const mark = () => document.body.classList.toggle('full', isFull());
    document.addEventListener('fullscreenchange', mark);
    document.addEventListener('webkitfullscreenchange', mark);
    mark();
  } else if (!standalone && /iPhone|iPod/.test(navigator.userAgent)) homeScreenCard();
}

/** an iPhone in Safari: once, how to get the game without the address bar (Share, Add to Home Screen) */
function homeScreenCard(): void {
  const KEY2 = 'ramu.homeTip';
  try { if (localStorage.getItem(KEY2)) return; } catch { /* private window: shown each visit */ }
  const c = document.createElement('div');
  c.className = 'home-tip';
  const draw = () => {
    c.innerHTML = `<b>${t('home.title')}</b><span>${t('home.sub')}</span><button type="button">${t('home.ok')}</button>`;
    c.querySelector('button')!.addEventListener('click', () => {
      c.remove();
      try { localStorage.setItem(KEY2, '1'); } catch { /* private window */ }
    });
  };
  draw();
  onLang(draw);
  document.body.append(c);
}
