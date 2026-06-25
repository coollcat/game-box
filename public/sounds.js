let audioCtx = null;
let bgmInterval = null;
let musicEnabled = localStorage.getItem('musicEnabled') !== 'false';
let sfxEnabled = localStorage.getItem('sfxEnabled') !== 'false';
let musicGain = null;

function ensureCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone(freq, type = 'sine', duration = 0.15, vol = 0.08) {
  if (!sfxEnabled) return;
  ensureCtx();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(vol, audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration + 0.05);
}

function playMusicNote(freq, duration = 0.6, vol = 0.05, type = 'sine') {
  if (!musicEnabled) return;
  ensureCtx();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(vol, audioCtx.currentTime + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration + 0.1);
}

function playChord(freqs, duration = 1.2, vol = 0.04) {
  if (!musicEnabled) return;
  freqs.forEach((f, i) => setTimeout(() => playMusicNote(f, duration, vol), i * 40));
}

function getCurrentGame() {
  const m = location.pathname.match(/\/games\/([^\/?#]+?)(?:\.html)?$/);
  if (m) return m[1];
  const base = location.pathname.split('/').pop() || '';
  return base.replace(/\.html$/, '') || 'generic';
}

const NOTE = {
  C3: 130.81, E3: 164.81, G3: 196.00, A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
  C6: 1046.50, D6: 1174.66, E6: 1318.51, F6: 1396.91, G6: 1567.98, A6: 1760.00
};

const TRACKS = {
  snake:    { type: 'square',   tempo: 180, vol: 0.050, notes: [[NOTE.G4,0.12],[NOTE.C5,0.12],[NOTE.E5,0.12],[NOTE.G5,0.12],[NOTE.E5,0.12],[NOTE.C5,0.12],[null,0.12],[NOTE.G4,0.12],[NOTE.A4,0.12],[NOTE.C5,0.12],[NOTE.E5,0.12],[NOTE.D5,0.12],[NOTE.C5,0.12],[null,0.12]] },
  gomoku:   { type: 'triangle', tempo: 420, vol: 0.060, notes: [[NOTE.C5,0.4],[NOTE.D5,0.4],[NOTE.E5,0.4],[NOTE.G5,0.4],[NOTE.A5,0.4],[NOTE.G5,0.4],[NOTE.E5,0.4],[NOTE.D5,0.4]] },
  2048:     { type: 'sine',     tempo: 220, vol: 0.060, notes: [[NOTE.C4,0.2],[NOTE.E4,0.2],[NOTE.G4,0.2],[NOTE.C5,0.2],[NOTE.G4,0.2],[NOTE.E4,0.2],[NOTE.C4,0.2],[null,0.2],[NOTE.G4,0.2],[NOTE.B4,0.2],[NOTE.D5,0.2],[NOTE.G5,0.2],[NOTE.D5,0.2],[NOTE.B4,0.2],[NOTE.G4,0.2],[null,0.2]] },
  tictactoe:{ type: 'square',   tempo: 240, vol: 0.050, notes: [[NOTE.E5,0.15],[NOTE.E5,0.15],[NOTE.G5,0.15],[NOTE.A5,0.15],[NOTE.G5,0.15],[NOTE.E5,0.15],[null,0.15],[NOTE.C5,0.15],[NOTE.D5,0.15],[NOTE.E5,0.15],[NOTE.D5,0.15],[NOTE.C5,0.15]] },
  pong:     { type: 'sawtooth', tempo: 160, vol: 0.050, notes: [[NOTE.A4,0.1],[NOTE.A4,0.1],[NOTE.E5,0.1],[null,0.1],[NOTE.A4,0.1],[NOTE.A4,0.1],[NOTE.E5,0.1],[null,0.1],[NOTE.G5,0.1],[NOTE.E5,0.1],[NOTE.D5,0.1],[null,0.1]] },
  memory:   { type: 'sine',     tempo: 380, vol: 0.050, notes: [[NOTE.E5,0.3],[NOTE.B5,0.3],[NOTE.E6,0.3],[NOTE.B5,0.3],[NOTE.D5,0.3],[NOTE.A5,0.3],[NOTE.D6,0.3],[NOTE.A5,0.3]] },
  dots:     { type: 'triangle', tempo: 300, vol: 0.055, notes: [[NOTE.C5,0.25],[NOTE.E5,0.25],[NOTE.G5,0.25],[NOTE.B5,0.25],[NOTE.C6,0.25],[NOTE.B5,0.25],[NOTE.G5,0.25],[NOTE.E5,0.25]] },
  connect4: { type: 'square',   tempo: 200, vol: 0.055, notes: [[NOTE.C5,0.18],[NOTE.C5,0.18],[NOTE.G4,0.18],[NOTE.C5,0.18],[NOTE.E5,0.18],[NOTE.D5,0.18],[NOTE.C5,0.18],[null,0.18],[NOTE.G4,0.18],[NOTE.A4,0.18],[NOTE.C5,0.18],[NOTE.E5,0.18],[NOTE.D5,0.18],[NOTE.C5,0.18]] },
  rps:      { type: 'sawtooth', tempo: 170, vol: 0.050, notes: [[NOTE.E4,0.14],[NOTE.E4,0.14],[NOTE.E4,0.14],[null,0.14],[NOTE.A4,0.14],[NOTE.A4,0.14],[NOTE.A4,0.14],[null,0.14],[NOTE.B4,0.14],[NOTE.C5,0.14],[NOTE.B4,0.14],[NOTE.A4,0.14]] },
  drawguess:{ type: 'triangle', tempo: 260, vol: 0.050, notes: [[NOTE.C5,0.2],[NOTE.E5,0.2],[NOTE.G5,0.2],[NOTE.C6,0.2],[NOTE.G5,0.2],[NOTE.E5,0.2],[null,0.2],[NOTE.D5,0.2],[NOTE.F5,0.2],[NOTE.A5,0.2],[NOTE.D6,0.2],[NOTE.A5,0.2],[NOTE.F5,0.2]] },
  draw2guess:{type: 'sine',     tempo: 220, vol: 0.050, notes: [[NOTE.G5,0.18],[NOTE.E5,0.18],[NOTE.C5,0.18],[NOTE.E5,0.18],[NOTE.G5,0.18],[NOTE.C6,0.18],[NOTE.G5,0.18],[NOTE.E5,0.18],[null,0.18],[NOTE.A5,0.18],[NOTE.F5,0.18],[NOTE.D5,0.18],[NOTE.F5,0.18],[NOTE.A5,0.18],[NOTE.C6,0.18],[NOTE.A5,0.18]] },
  lobby:    { type: 'sine',     tempo: 420, vol: 0.050, notes: [[NOTE.C5,0.35],[NOTE.E5,0.35],[NOTE.G5,0.35],[NOTE.B5,0.35],[NOTE.C6,0.5],[NOTE.B5,0.35],[NOTE.G5,0.35],[NOTE.E5,0.35]] },
  portal:   { type: 'sawtooth', tempo: 450, vol: 0.045, notes: [[NOTE.A3,0.4],[NOTE.E4,0.4],[NOTE.A4,0.4],[NOTE.B4,0.4],[NOTE.C5,0.4],[NOTE.B4,0.4],[NOTE.A4,0.4],[NOTE.E4,0.4]] }
};

const PENTATONIC = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25];

const Sounds = {
  musicEnabled() { return musicEnabled; },
  sfxEnabled() { return sfxEnabled; },
  setMusicEnabled(v) {
    musicEnabled = v;
    localStorage.setItem('musicEnabled', v);
    if (v) this.startBGM(); else this.stopBGM();
  },
  setSfxEnabled(v) {
    sfxEnabled = v;
    localStorage.setItem('sfxEnabled', v);
  },
  enable() {
    ensureCtx();
    if (musicEnabled) this.startBGM();
  },
  startBGM() {
    if (bgmInterval) return;
    if (!musicEnabled) return;
    ensureCtx();
    const game = getCurrentGame();
    const track = TRACKS[game];
    if (track) {
      let beat = 0;
      const vol = track.vol || 0.05;
      bgmInterval = setInterval(() => {
        const n = track.notes[beat % track.notes.length];
        if (n) playMusicNote(n[0], n[1] || 0.3, vol, track.type);
        beat++;
      }, track.tempo);
    } else {
      let beat = 0;
      bgmInterval = setInterval(() => {
        const idx = beat % PENTATONIC.length;
        const note = PENTATONIC[idx];
        playMusicNote(note, 0.7, 0.05, 'sine');
        if (beat % 4 === 0) playChord([note, note * 1.25, note * 1.5], 1.5, 0.035);
        beat++;
      }, 520);
    }
  },
  stopBGM() {
    if (bgmInterval) { clearInterval(bgmInterval); bgmInterval = null; }
  },
  // SFX
  place() { playTone(880, 'sine', 0.08, 0.08); },
  hit() { playTone(520, 'sine', 0.08, 0.08); },
  score() { playTone(1200, 'sine', 0.2, 0.1); },
  win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => playTone(f, 'sine', 0.25, 0.12), i * 120)); },
  lose() { [350, 300, 250].forEach((f, i) => setTimeout(() => playTone(f, 'sawtooth', 0.25, 0.06), i * 120)); },
  chat() { playTone(1400, 'sine', 0.06, 0.05); },
  correct() { [880, 1100, 1320].forEach((f, i) => setTimeout(() => playTone(f, 'sine', 0.1, 0.08), i * 80)); },
  wrong() { playTone(160, 'sawtooth', 0.2, 0.08); }
};

// Initialize toggles on the page if present
function initSoundToggles() {
  const musicCheck = document.getElementById('music-check');
  const sfxCheck = document.getElementById('sfx-check');
  const soundCheck = document.getElementById('sound-check');
  if (musicCheck) {
    musicCheck.checked = musicEnabled;
    musicCheck.addEventListener('change', e => Sounds.setMusicEnabled(e.target.checked));
  }
  if (sfxCheck) {
    sfxCheck.checked = sfxEnabled;
    sfxCheck.addEventListener('change', e => Sounds.setSfxEnabled(e.target.checked));
  }
  if (soundCheck && !musicCheck && !sfxCheck) {
    soundCheck.checked = sfxEnabled;
    soundCheck.addEventListener('change', e => {
      Sounds.setSfxEnabled(e.target.checked);
      Sounds.setMusicEnabled(e.target.checked);
    });
  }
}

window.addEventListener('DOMContentLoaded', initSoundToggles);

// Shared util: robust copy to clipboard with fallback
window.copyToClipboard = async function(text, el, successText = '✅') {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    if (el) { const old = el.textContent; el.textContent = successText; setTimeout(() => el.textContent = old, 2000); }
  } catch (e) {
    window.prompt('复制以下链接', text);
  }
};
