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

  // fullscreen, sideways: asked on the first tap (browsers only allow it from one)
  const goFull = () => {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => { /* not allowed here: the card asks instead */ });
  };
  addEventListener('touchend', goFull, { once: true, capture: true });
}
