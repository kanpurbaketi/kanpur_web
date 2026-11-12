/*
 Key bindings. Every action has two slots (a main key and an alternative); a slot holds a KeyboardEvent.code
 ('KeyW', 'Space', 'ShiftLeft', ...) or a mouse button ('Mouse0' = left click) or '' for none.
 Saved in localStorage, so they apply to this browser only; the menu's Controls panel edits them live.
*/

export type Action = 'forward' | 'back' | 'left' | 'right' | 'run' | 'jump' | 'crouch' | 'punch' | 'map';

export const ACTIONS: { id: Action; label: string }[] = [
  { id: 'forward', label: 'Move forward' },
  { id: 'back', label: 'Move back' },
  { id: 'left', label: 'Move left' },
  { id: 'right', label: 'Move right' },
  { id: 'run', label: 'Run (hold)' },
  { id: 'jump', label: 'Jump' },
  { id: 'crouch', label: 'Crouch (hold)' },
  { id: 'punch', label: 'Punch' },
  { id: 'map', label: 'Open map' },
];

export const DEFAULTS: Record<Action, [string, string]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space', ''],
  crouch: ['KeyC', 'ControlLeft'],
  punch: ['KeyF', 'Mouse0'],
  map: ['KeyM', ''],
};

const KEY = 'kanpur.controls.v1';

export class Controls {
  private b: Record<Action, [string, string]>;
  private listeners: (() => void)[] = [];

  constructor() {
    this.b = structuredClone(DEFAULTS);
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<Action, [string, string]>>;
      for (const a of ACTIONS) {
        const s = saved[a.id];
        if (Array.isArray(s) && s.length === 2 && s.every((v) => typeof v === 'string')) this.b[a.id] = [s[0], s[1]];
      }
    } catch {
      /* storage unavailable or corrupt: defaults */
    }
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  get(a: Action): [string, string] {
    return this.b[a];
  }

  /** is `code` bound to this action? */
  matches(a: Action, code: string): boolean {
    return code !== '' && (this.b[a][0] === code || this.b[a][1] === code);
  }

  /** is any key of this action currently held? (`down` = the set of held codes) */
  held(a: Action, down: Set<string>): boolean {
    const [x, y] = this.b[a];
    return (x !== '' && down.has(x)) || (y !== '' && down.has(y));
  }

  /** Bind `code` to a slot. The same key cannot do two things: it is taken away from wherever it was. Returns the action it was taken from, if any. */
  set(a: Action, slot: 0 | 1, code: string): Action | null {
    let from: Action | null = null;
    if (code) {
      for (const o of ACTIONS) {
        for (const s of [0, 1] as const) {
          if (this.b[o.id][s] === code && !(o.id === a && s === slot)) {
            this.b[o.id][s] = '';
            from = o.id;
          }
        }
      }
    }
    this.b[a][slot] = code;
    this.save();
    return from;
  }

  reset(): void {
    this.b = structuredClone(DEFAULTS);
    this.save();
  }

  isDefault(a: Action, slot: 0 | 1): boolean {
    return this.b[a][slot] === DEFAULTS[a][slot];
  }

  /** the line under the game: "Click to look · WASD move · ..." built from the current bindings */
  hint(): string {
    const k = (a: Action) => label(this.b[a][0] || this.b[a][1]);
    const dirs = [k('forward'), k('left'), k('back'), k('right')];
    const move = dirs.every((d) => d.length === 1) ? dirs.join('') : dirs.join('/');
    return `Click to look · ${move} move · ${k('run')} run · ${k('jump')} jump · ${k('crouch')} crouch · ${k('punch')} punch · Esc release mouse`;
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.b));
    } catch {
      /* storage unavailable */
    }
    for (const f of this.listeners) f();
  }
}

/** Human-readable name of a key code. */
export function label(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (code.startsWith('Mouse')) return ['Left click', 'Middle click', 'Right click'][Number(code.slice(5))] ?? `Mouse ${code.slice(5)}`;
  const names: Record<string, string> = {
    Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt', AltRight: 'Right Alt', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
  };
  return names[code] ?? code;
}
