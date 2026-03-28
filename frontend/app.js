// ── State ─────────────────────────────────────────────────────────────────────
const state = {
    ws: null,
    myId: null,
    myName: '',
    users: new Map(),
    isTalking: false,
    mediaStream: null,
    mediaRecorder: null,
    audioContext: null,
    analyserNode: null,
    animFrameId: null,
    currentSpeakerId: null,
    strings: null,
    lang: 'en',
};

// ── DOM refs ───────────────────────────────────────────────────────────────────
const pttBtn         = document.getElementById('ptt-btn');
const nameInput      = document.getElementById('name-input');
const talkingBanner  = document.getElementById('talking-banner');
const talkingName    = document.getElementById('talking-name');
const usersEl        = document.getElementById('users');
const statusConn     = document.getElementById('status-conn');
const visualizerWrap = document.getElementById('visualizer-wrap');
const canvas         = document.getElementById('visualizer');
const ctx2d          = canvas.getContext('2d');

// ── WebSocket ──────────────────────────────────────────────────────────────────
let reconnectDelay = 2000;

function connectWS() {
    const name = encodeURIComponent(state.myName || '');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.ws = new WebSocket(`${proto}//${location.host}/ws?name=${name}`);
    state.ws.binaryType = 'arraybuffer';

    state.ws.onopen = () => {
        reconnectDelay = 2000;
        statusConn.textContent = 'Connected';
        statusConn.className = 'connected';
        if (state.lang) sendJSON({ type: 'set_lang', lang: state.lang });
        if (megaphoneEnabled) sendJSON({ type: 'set_megaphone', enabled: true });
    };

    state.ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
            if (_expectingTranslatedAudio && e.data.byteLength > 10000) {
                _expectingTranslatedAudio = false;
                playTranslatedAudio(e.data);
            } else if (!_expectingTranslatedAudio) {
                enqueueChunk(e.data);
            }
            // else: stray small chunk before translated WAV — discard
        } else {
            handleSignal(JSON.parse(e.data));
        }
    };

    state.ws.onclose = () => {
        const s = state.strings || languages['en'];
        statusConn.textContent = s.reconnecting;
        statusConn.className = 'disconnected';
        state.users.clear();
        renderUsers();
        setTimeout(connectWS, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
    };
}

function handleSignal(msg) {
    switch (msg.type) {
        case 'init':
            state.myId = msg.your_id;
            state.users.clear();
            msg.users.forEach(u => state.users.set(u.client_id, { name: u.name, talking: u.talking }));
            // Sync our name from server (server may have sanitised it)
            const me = state.users.get(state.myId);
            if (me) {
                state.myName = me.name;
                nameInput.value = me.name;
            }
            renderUsers();
            break;
        case 'user_joined':
            state.users.set(msg.client_id, { name: msg.name, talking: false });
            renderUsers();
            break;
        case 'user_left':
            state.users.delete(msg.client_id);
            if (state.currentSpeakerId === msg.client_id) {
                state.currentSpeakerId = null;
                hideTalkingBanner();
                pttBtn.classList.remove('blocked');
            }
            if (_processingFor !== null) {
                hideProcessing();
            }
            renderUsers();
            break;
        case 'talking_state':
            if (state.users.has(msg.client_id)) {
                state.users.get(msg.client_id).talking = msg.talking;
                state.users.get(msg.client_id).name = msg.name;
            }
            if (msg.talking) {
                state.currentSpeakerId = msg.client_id;
                if (msg.client_id !== state.myId) {
                    showTalkingBanner(msg.name);
                    resetPlayback();
                    _expectingTranslatedAudio = false;
                    _currentSpeakerMegaphone = !!msg.megaphone;
                    pttBtn.classList.add('blocked');
                    hideProcessing();
                }
            } else {
                if (state.currentSpeakerId === msg.client_id) {
                    state.currentSpeakerId = null;
                    hideTalkingBanner();
                    pttBtn.classList.remove('blocked');
                    if (_currentSpeakerMegaphone) {
                        // chunks were played live via enqueueChunk — nothing to do on release
                    } else {
                        resetPlayback();
                        if (msg.client_id !== state.myId) showProcessing(msg.name);
                    }
                    _currentSpeakerMegaphone = false;
                }
            }
            renderUsers();
            break;
        case 'name_change':
            if (state.users.has(msg.client_id)) {
                state.users.get(msg.client_id).name = msg.name;
            }
            renderUsers();
            break;
        case 'transcript':
            hideProcessing();
            showTranscript(msg.text, !msg.final);
            break;
        case 'translated_audio_start':
            _expectingTranslatedAudio = true;
            hideProcessing();
            if (msg.text) showTranscript(msg.text, false);
            break;
    }
}

function sendJSON(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(obj));
    }
}

// ── Audio capture ──────────────────────────────────────────────────────────────
function getSupportedMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const t of types) {
        if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
}

let _activeMimeType = '';

async function startTalking() {
    if (state.isTalking) return;
    if (state.currentSpeakerId && state.currentSpeakerId !== state.myId) return;

    // Warm up AudioContext on user gesture
    getPlaybackCtx();

    state.isTalking = true;
    pttBtn.classList.add('active');
    startVisualizer(); // show immediately — idle state until mic data flows

    try {
        if (!state.mediaStream) {
            state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            setupAnalyser(state.mediaStream);
        }

        const mimeType = getSupportedMimeType();
        _activeMimeType = mimeType;
        const recorderOptions = {};
        if (mimeType) recorderOptions.mimeType = mimeType;
        state.mediaRecorder = new MediaRecorder(state.mediaStream, recorderOptions);

        // iOS Safari only fires ondataavailable reliably at stop(), not on timeslice intervals.
        // Use timeslice only on platforms that support webm (Chrome/Firefox).
        const useTimeslice = mimeType.includes('webm') || mimeType.includes('ogg');

        state.mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0 && state.ws?.readyState === WebSocket.OPEN) {
                state.ws.send(e.data);
            }
        };

        // Always send talking_stop from onstop — guarantees all chunks are flushed first
        // on both webm (timeslice) and mp4 (single chunk at stop) paths.
        state.mediaRecorder.onstop = () => {
            sendJSON({ type: 'talking_stop' });
        };

        state.mediaRecorder.onerror = (e) => console.error('Recorder error:', e.error);

        state.mediaRecorder.start(useTimeslice ? 100 : undefined);
        sendJSON({ type: 'talking_start' });
    } catch (err) {
        console.error('Mic error:', err);
        state.isTalking = false;
        pttBtn.classList.remove('active');
    }
}

function stopTalking() {
    if (!state.isTalking) return;
    state.isTalking = false;
    pttBtn.classList.remove('active');

    const recorder = state.mediaRecorder;
    state.mediaRecorder = null;
    stopVisualizer();

    if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
        // Force-stop all tracks — on iOS this is required to actually trigger onstop
        if (state.mediaStream) {
            state.mediaStream.getTracks().forEach(t => t.stop());
            state.mediaStream = null;
        }
    } else {
        sendJSON({ type: 'talking_stop' });
    }
}

// ── Transcript history ─────────────────────────────────────────────────────────
const transcriptBox = document.getElementById('transcript-box');
const MAX_HISTORY = 5;

function showTranscript(text, isInterim) {
    if (isInterim) {
        // Update or create interim entry
        let interim = transcriptBox.querySelector('.interim');
        if (!interim) {
            interim = document.createElement('div');
            interim.className = 'transcript-entry interim';
            transcriptBox.appendChild(interim);
        }
        interim.textContent = text;
        return;
    }

    // Remove any interim entry
    const interim = transcriptBox.querySelector('.interim');
    if (interim) interim.remove();

    // Age existing entries
    const entries = transcriptBox.querySelectorAll('.transcript-entry');
    entries.forEach(el => {
        if (el.classList.contains('old')) {
            el.classList.add('older');
        } else {
            el.classList.add('old');
        }
    });

    // Remove entries beyond history limit
    const all = transcriptBox.querySelectorAll('.transcript-entry');
    if (all.length >= MAX_HISTORY) {
        all[0].remove();
    }

    // Add new entry at top
    const entry = document.createElement('div');
    entry.className = 'transcript-entry';
    entry.textContent = text;
    transcriptBox.prepend(entry);

    // Fade out after 1 minute, remove after 5 minutes
    setTimeout(() => entry.classList.add('old'), 60000);
    setTimeout(() => entry.remove(), 300000);
}

// ── Processing indicator ───────────────────────────────────────────────────────
const processingIndicator = document.getElementById('processing-indicator');
const processingName = document.getElementById('processing-name');
let _processingFor = null;

function showProcessing(name) {
    _processingFor = name;
    processingName.textContent = name;
    processingIndicator.classList.add('visible');
}

function hideProcessing() {
    _processingFor = null;
    processingIndicator.classList.remove('visible');
}

// ── Audio playback (Web Audio API) ────────────────────────────────────────────
// Collect chunks per transmission, decode and play when we have enough data.
// Uses a running decode approach: decode each chunk as a complete webm blob.

let _expectingTranslatedAudio = false;
let _currentSpeakerMegaphone = false;

function playTranslatedAudio(arrayBuffer) {
    const ac = getPlaybackCtx();
    ac.decodeAudioData(arrayBuffer.slice(0), (decoded) => {
        const source = ac.createBufferSource();
        source.buffer = decoded;
        source.connect(ac.destination);
        source.start(0);
    }, () => {
        // Decode failed — likely a stray chunk, not a complete audio file. Ignore.
    });
}

let playbackCtx = null;
let playbackChunks = [];   // ArrayBuffers received in current transmission

function getPlaybackCtx() {
    if (!playbackCtx || playbackCtx.state === 'closed') {
        playbackCtx = new AudioContext();
    }
    if (playbackCtx.state === 'suspended') {
        playbackCtx.resume();
    }
    return playbackCtx;
}

function resetPlayback() {
    playbackChunks = [];
    lastScheduledEnd = 0;
}

function enqueueChunk(arrayBuffer) {
    playbackChunks.push(arrayBuffer);
    // Try to decode accumulated chunks so far for low-latency playback
    decodeAndPlay();
}

function decodeAndPlay() {
    if (playbackChunks.length === 0) return;

    // Combine all chunks received so far into one blob
    const blob = new Blob(playbackChunks, { type: _activeMimeType || getSupportedMimeType() || 'audio/webm;codecs=opus' });
    blob.arrayBuffer().then(buf => {
        const ac = getPlaybackCtx();
        const promise = ac.decodeAudioData(buf.slice(0), (decoded) => {
            scheduleDecoded(decoded);
        }, () => {
            // Decoding partial webm often fails — that's fine, wait for more chunks
        });
        if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    });
}

let lastScheduledEnd = 0;

function scheduleDecoded(decoded) {
    const ac = getPlaybackCtx();
    const now = ac.currentTime;

    // If we've fallen behind, reset schedule position
    if (lastScheduledEnd < now) {
        lastScheduledEnd = now + 0.05; // small buffer
    }

    // Only play the newly decoded portion beyond what we've already scheduled
    const source = ac.createBufferSource();
    source.buffer = decoded;
    source.connect(ac.destination);

    // Play from current schedule end, but only the tail we haven't played
    // Simple approach: always play the full decoded buffer from "now" if we're not too far ahead
    const lookAhead = lastScheduledEnd - now;
    if (lookAhead < 0.5) {
        // Not too far ahead — schedule it
        source.start(lastScheduledEnd);
        lastScheduledEnd = lastScheduledEnd + decoded.duration;
    }
    // If too far ahead, skip to avoid buildup
}

// ── Visualizer ─────────────────────────────────────────────────────────────────
function setupAnalyser(stream) {
    state.audioContext = new AudioContext();
    const source = state.audioContext.createMediaStreamSource(stream);
    state.analyserNode = state.audioContext.createAnalyser();
    state.analyserNode.fftSize = 256;
    state.analyserNode.smoothingTimeConstant = 0.8;
    source.connect(state.analyserNode);
    // NOT connected to destination — no feedback
}

function startVisualizer() {
    visualizerWrap.classList.add('visible');
    canvas.width = canvas.offsetWidth * devicePixelRatio;
    canvas.height = canvas.offsetHeight * devicePixelRatio;
    drawVisualizer();
}

function stopVisualizer() {
    visualizerWrap.classList.remove('visible');
    if (state.animFrameId) {
        cancelAnimationFrame(state.animFrameId);
        state.animFrameId = null;
    }
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
}

let _idlePhase = 0;

function drawVisualizer() {
    state.animFrameId = requestAnimationFrame(drawVisualizer);

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    ctx2d.clearRect(0, 0, w, h);

    const hasAnalyser = !!state.analyserNode;
    const bufLen = hasAnalyser ? state.analyserNode.frequencyBinCount : 32;
    const data = new Uint8Array(bufLen);
    if (hasAnalyser) state.analyserNode.getByteFrequencyData(data);

    // Check if there's any real signal
    const maxVal = hasAnalyser ? Math.max(...data) : 0;
    const hasSignal = maxVal > 8;

    const barWidth = w / bufLen;

    if (!hasSignal) {
        // No signal — draw a flat animated line with slow pulse dots
        _idlePhase += 0.05;
        const midY = h / 2;
        const isTheme = document.body.classList.contains('theme-radar');
        const lineColor = isTheme ? 'rgba(0,255,65,0.25)' : 'rgba(160,0,0,0.25)';
        const dotColor  = isTheme ? 'rgba(0,255,65,0.5)'  : 'rgba(160,0,0,0.5)';

        // Flat baseline
        ctx2d.fillStyle = lineColor;
        ctx2d.fillRect(0, midY - 0.5, w, 1);

        // Three slow-pulsing dots evenly spaced
        for (let d = 0; d < 3; d++) {
            const x = w * (d + 1) / 4;
            const pulse = 0.3 + 0.3 * Math.sin(_idlePhase + d * 2.1);
            const r = 1.5 + pulse * 1.5;
            ctx2d.beginPath();
            ctx2d.arc(x, midY, r, 0, Math.PI * 2);
            ctx2d.fillStyle = dotColor;
            ctx2d.fill();
        }
        return;
    }

    // Real signal — draw frequency bars
    for (let i = 0; i < bufLen; i++) {
        const v = data[i] / 255;
        const barHeight = v * h;
        const alpha = 0.3 + v * 0.7;
        const isTheme = document.body.classList.contains('theme-radar');
        ctx2d.fillStyle = isTheme ? `rgba(0,255,65,${alpha})` : `rgba(200,20,0,${alpha})`;
        ctx2d.fillRect(i * barWidth, h - barHeight, Math.max(barWidth - 1, 1), barHeight);
    }
}

// ── Talking banner ─────────────────────────────────────────────────────────────
function showTalkingBanner(name) {
    talkingName.textContent = name;
    talkingBanner.classList.add('visible');
}

function hideTalkingBanner() {
    talkingBanner.classList.remove('visible');
}

// ── User presence ──────────────────────────────────────────────────────────────
function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderUsers() {
    const s = state.strings || themeStrings['theme-clean'];
    const count = state.users.size;
    statusConn.textContent = `Connected · ${count} on channel`;
    statusConn.className = 'connected';

    usersEl.innerHTML = '';
    for (const [id, user] of state.users) {
        const el = document.createElement('div');
        el.className = 'user-row' + (user.talking ? ' talking' : '');
        el.innerHTML =
            `<span class="user-dot${user.talking ? ' active' : ''}"></span>` +
            `<span>${escapeHtml(user.name)}</span>` +
            (user.talking ? `<span class="user-live">${s.userLive}</span>` : '') +
            (id === state.myId ? `<span class="user-you">${s.userYou}</span>` : '');
        usersEl.appendChild(el);
    }
}

// ── PTT button ─────────────────────────────────────────────────────────────────
pttBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pttBtn.setPointerCapture(e.pointerId);
    startTalking();
});
pttBtn.addEventListener('pointerup', stopTalking);
pttBtn.addEventListener('pointercancel', stopTalking);

// ── Spacebar PTT ───────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && document.activeElement !== nameInput) {
        e.preventDefault();
        startTalking();
    }
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        stopTalking();
    }
});

// ── Name input ─────────────────────────────────────────────────────────────────
nameInput.addEventListener('change', () => {
    const name = nameInput.value.trim();
    if (name) {
        state.myName = name;
        sendJSON({ type: 'name_change', name });
    }
});

// ── Theme toggle ───────────────────────────────────────────────────────────────
const themes = ['theme-clean', 'theme-radar'];
let themeIndex = 0;

document.getElementById('theme-btn').addEventListener('click', () => {
    document.body.classList.remove(themes[themeIndex]);
    themeIndex = (themeIndex + 1) % themes.length;
    document.body.classList.add(themes[themeIndex]);
});

// ── Megaphone toggle ───────────────────────────────────────────────────────────
let megaphoneEnabled = false;

document.getElementById('megaphone-btn').addEventListener('click', () => {
    megaphoneEnabled = !megaphoneEnabled;
    document.getElementById('megaphone-btn').classList.toggle('active', megaphoneEnabled);
    sendJSON({ type: 'set_megaphone', enabled: megaphoneEnabled });
});

// ── Language toggle ────────────────────────────────────────────────────────────
const languages = {
    en: {
        tagline:      '– bara säg till',
        nameLabel:    'Name',
        pttLabel:     'Hold to Talk',
        bannerPrefix: 'NOW TALKING:',
        userYou:      'you',
        userLive:     'LIVE',
        reconnecting: 'Reconnecting…',
    },
    qc: {
        tagline:      '– dis-le moé',
        nameLabel:    'Nom',
        pttLabel:     'Tiens pis parle',
        bannerPrefix: 'ASTEURE Y\'PARLE:',
        userYou:      'toé',
        userLive:     'SUR LES ONDES',
        reconnecting: 'On r\'essaye…',
    },
    sml: {
        tagline:      '– säj ba te',
        nameLabel:    'Namn',
        pttLabel:     'Håll å prat',
        bannerPrefix: 'NU PRATAR:',
        userYou:      'du sjölv',
        userLive:     'PÅ LUFTEN',
        reconnecting: 'Försöker igen…',
    },
    lidingo: {
        tagline:      '– typ, säg till asså',
        nameLabel:    'Namn',
        pttLabel:     'Håll in, liksom',
        bannerPrefix: 'PRATAR JUST NU:',
        userYou:      'du asså',
        userLive:     'PÅ LUFTEN',
        reconnecting: 'Reconnectar…',
    },
    gbg: {
        tagline:      '– ba säj te dåå',
        nameLabel:    'Namn',
        pttLabel:     'Håll i å snacka',
        bannerPrefix: 'SNACKAR NU:',
        userYou:      'du dåå',
        userLive:     'PÅ LOFTET',
        reconnecting: 'Försöker igen dåå…',
    },
    blatte: {
        tagline:      '– lägg ett snack',
        nameLabel:    'Namn',
        pttLabel:     'Tryck å keff',
        bannerPrefix: 'KEFFAR NU:',
        userYou:      'du själv bre',
        userLive:     'I TRAFIKEN',
        reconnecting: 'Vänta bre…',
    },
};

function applyLanguage(lang) {
    const s = languages[lang];
    state.strings = s;
    state.lang = lang;
    document.querySelector('.tagline').textContent = s.tagline;
    document.getElementById('name-label').textContent = s.nameLabel;
    document.querySelector('.ptt-label').textContent = s.pttLabel;
    document.querySelector('#talking-banner span:first-of-type').textContent = s.bannerPrefix;
    document.querySelectorAll('.lang-opt').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    sendJSON({ type: 'set_lang', lang });
    renderUsers();
}

document.querySelectorAll('.lang-opt').forEach(btn => {
    btn.addEventListener('click', () => applyLanguage(btn.dataset.lang));
});

// ── Init ───────────────────────────────────────────────────────────────────────
function init() {
    applyLanguage('en');
    const unlock = document.getElementById('audio-unlock');
    const hint = document.getElementById('unlock-hint');
    unlock.addEventListener('click', async () => {
        // Create and immediately resume AudioContext on user gesture
        playbackCtx = new AudioContext();
        playbackCtx.resume();

        // Request mic permission now so first PTT press is instant
        hint.textContent = 'Requesting microphone…';
        try {
            state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            setupAnalyser(state.mediaStream);
        } catch (err) {
            // Permission denied or unavailable — PTT will prompt again when pressed
        }

        unlock.style.display = 'none';
        connectWS();
    }, { once: true });
}

init();
