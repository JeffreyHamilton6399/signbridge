/**
 * SignBridge.
 *
 * Layout follows one idea: the camera view is the document. Video fills the
 * frame, captions are typography laid over it, and every control sits at an
 * extreme edge - never in the centre-bottom of frame, which is exactly where
 * hands are.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PipelineProvider, usePipeline } from '@/vision/pipeline';
import { useSession, useSettings } from '@/store';
import { useTheme } from '@/ui/useTheme';
import { Disclaimer } from '@/ui/Disclaimer';
import { Captions } from '@/ui/Captions';
import { FramingGuide, LandmarkOverlay } from '@/ui/LandmarkOverlay';
import { Alternates, ConfidenceBar } from '@/ui/ConfidenceBar';
import { Controls, SuggestionStrip } from '@/ui/Controls';
import { CorrectionSheet } from '@/ui/CorrectionSheet';
import { SettingsPanel, downloadFile } from '@/ui/SettingsPanel';
import { CalibrationFlow } from '@/ui/CalibrationFlow';
import { DebugPanel } from '@/ui/DebugPanel';
import { Onboarding } from '@/ui/Onboarding';
import { UpdatePrompt } from '@/ui/UpdatePrompt';
import { useFingerspell } from '@/modes/fingerspell/useFingerspell';
import { SignsMode } from '@/modes/signs/SignsMode';
import { ReverseMode } from '@/modes/reverse/ReverseMode';
import { ConversationMode } from '@/modes/conversation/ConversationMode';
import { toPlainText } from '@/ui/transcript';
import { speak, inferPunctuation } from '@/speech/tts';
import { pruneTranscripts } from '@/db/idb';
import type { Mode } from '@/settings/schema';
import { CONFUSION_CLUSTERS, FIST_CLUSTER, STATIC_LETTERS } from '@/modes/fingerspell/letterTemplates';

export default function App() {
  return (
    <PipelineProvider>
      <Shell />
    </PipelineProvider>
  );
}

// Short labels are all one plain word. The set used to mix a glyph string
// (A·B·C), a word (Signs) and an arrow formula (Text→ASL), which read as three
// different kinds of thing sitting in one switcher.
const MODES: { id: Mode; label: string; short: string }[] = [
  { id: 'fingerspell', label: 'Fingerspell', short: 'Letters' },
  { id: 'signs', label: 'Signs', short: 'Signs' },
  { id: 'conversation', label: 'Conversation', short: 'Talk' },
  { id: 'reverse', label: 'Reverse', short: 'Reverse' },
];

function Shell() {
  useTheme();
  const pipeline = usePipeline();
  const settings = useSettings((s) => s.settings);
  const loaded = useSettings((s) => s.loaded);
  const hydrate = useSettings((s) => s.hydrate);
  const patch = useSettings((s) => s.patch);
  const session = useSession;

  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which letters calibration should record, or null when it is closed. The
  // fist cluster gets its own short run — see FIST_CLUSTER.
  const [calibrating, setCalibrating] = useState<readonly string[] | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [signRecorderOpen, setSignRecorderOpen] = useState(false);
  // Signs mode fills this in; the alternates strip calls it so that picking a
  // different sign both fixes the transcript and teaches the recogniser.
  const teachSignRef = useRef<((label: string) => void) | null>(null);
  // On a phone you cannot hold the device and sign at the same time, so it gets
  // propped up and looked at from a distance. Tapping the view clears the
  // controls out of the way — the disclaimer stays, because it always does.
  const [immersive, setImmersive] = useState(false);
  const barRef = useMeasuredHeight('--sb-bar-h');
  // A, S, T, M, N and E are all fists that differ only by an occluded thumb, so
  // the right correction is often not in the top three. Offer the whole cluster.
  // Read reactively: getState() in the render body would freeze on first paint.
  const topGuess = useSession((s) => s.alternates[0]?.label);

  const mode = settings.recognition.mode;
  const cameraMode = mode === 'fingerspell' || mode === 'signs' || mode === 'conversation';

  const fingerspell = useFingerspell(mode === 'fingerspell' && pipeline.active);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (loaded && settings.privacy.autoDeleteAfterDays > 0) {
      void pruneTranscripts(settings.privacy.autoDeleteAfterDays);
    }
  }, [loaded, settings.privacy.autoDeleteAfterDays]);

  // Conversation mode is gated on its own experimental flag; if the flag is off,
  // fall back rather than showing a mode that cannot work.
  useEffect(() => {
    if (mode === 'conversation' && !settings.experimental.conversationMode) {
      patch({ recognition: { mode: 'fingerspell' } });
    }
  }, [mode, settings.experimental.conversationMode, patch]);

  const speakAll = useCallback(() => {
    const state = session.getState();
    const text = [...state.tokens.map((t) => t.text), state.buffer].filter(Boolean).join(' ');
    if (!text) return;
    speak(settings.speechOut.punctuationInference ? inferPunctuation(text) : text, {
      voiceURI: settings.speechOut.voiceURI,
      rate: settings.speechOut.rate,
      pitch: settings.speechOut.pitch,
      volume: settings.speechOut.volume,
      interrupt: true,
    });
  }, [session, settings.speechOut]);

  const exportTranscript = useCallback(() => {
    const state = session.getState();
    downloadFile(
      `signbridge-transcript-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`,
      toPlainText(state.tokens, state.startedAt, settings.recognition.confidenceThreshold),
      'text/plain',
    );
  }, [session, settings.recognition.confidenceThreshold]);

  // Keyboard shortcuts. Skipped whenever focus is in a text field, so typing in
  // Reverse mode does not trigger them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          fingerspell.commitSpace();
          break;
        case 'backspace':
          e.preventDefault();
          session.getState().backspace();
          break;
        case 'f':
          setCorrectionOpen(true);
          break;
        case 'r':
          speakAll();
          break;
        case 'e':
          exportTranscript();
          break;
        case 'd':
          setDebugOpen((v) => !v);
          break;
        case ',':
          setSettingsOpen(true);
          break;
        case 'escape':
          setDebugOpen(false);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fingerspell, session, speakAll, exportTranscript]);

  if (!loaded) {
    return (
      <div className="grid h-full place-items-center text-sm text-[var(--sb-fg-muted)]">Loading…</div>
    );
  }

  const showOnboarding = cameraMode && !pipeline.active;
  const confusionOptions = topGuess ? (CONFUSION_CLUSTERS[topGuess] ?? []) : [];

  return (
    <div className="relative h-full w-full overflow-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-[var(--color-signal)] focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#1a1200]"
      >
        Skip to controls
      </a>

      {/* Video is always mounted so the stream survives a mode switch. */}
      <video
        ref={pipeline.videoRef}
        playsInline
        muted
        aria-hidden="true"
        className={`absolute inset-0 h-full w-full bg-[var(--color-ink-900)] object-cover transition-opacity ${
          cameraMode && pipeline.active ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transform: settings.camera.mirror ? 'scaleX(-1)' : undefined }}
      />

      {cameraMode && pipeline.active && (
        <>
          <button
            type="button"
            aria-label={immersive ? 'Show controls' : 'Hide controls'}
            aria-pressed={immersive}
            onClick={() => setImmersive((v) => !v)}
            className="absolute inset-0 z-[5] cursor-default"
          />
          <LandmarkOverlay />
          {settings.camera.framingGuide && <FramingGuide scan={fingerspell.scan} />}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[38%] bg-gradient-to-t from-black/70 to-transparent" />
        </>
      )}

      {/* Top chrome. On a phone the disclaimer, the mode switcher and the
          utilities stack into one column: laying them out as separate absolutely
          positioned elements made them overlap on a 390px screen. On wider
          screens the mode switcher moves to a rail down the left edge, out of
          the centre of frame where hands are. */}
      <div
        className={`absolute inset-x-0 top-0 z-40 flex flex-col gap-1.5 px-2 pt-[env(safe-area-inset-top)] ${
          cameraMode && pipeline.active ? 'sb-on-video' : ''
        }`}
      >
        <Disclaimer />
        <div className={`flex items-center gap-1.5 sm:hidden short:flex ${immersive ? 'invisible opacity-0' : 'visible opacity-100'} transition-[opacity,visibility] duration-300`}>
          <nav aria-label="Mode" className="sb-scroll flex gap-1 overflow-x-auto">
            <ModeButtons
              mode={mode}
              conversationEnabled={settings.experimental.conversationMode}
              onPick={(id) => patch({ recognition: { mode: id } })}
              compact
            />
          </nav>
          <div className="ml-auto flex shrink-0 gap-1">
            <UtilityButtons
              compact
              showDebug={false}
              showRecord={mode === 'signs'}
              debugOpen={debugOpen}
              onToggleDebug={() => setDebugOpen((v) => !v)}
              onRecord={() => setSignRecorderOpen(true)}
              onSettings={() => setSettingsOpen(true)}
            />
          </div>
        </div>
      </div>

      {/* Mode rail — wide screens only, at the extreme left edge. */}
      <nav
        aria-label="Mode"
        className={`absolute top-1/2 left-2 z-30 hidden -translate-y-1/2 flex-col gap-1.5 sm:flex short:hidden ${immersive ? 'invisible opacity-0' : 'visible opacity-100'} transition-[opacity,visibility] duration-300 ${
          cameraMode && pipeline.active ? 'sb-on-video' : ''
        }`}
      >
        <ModeButtons
          mode={mode}
          conversationEnabled={settings.experimental.conversationMode}
          onPick={(id) => patch({ recognition: { mode: id } })}
        />
      </nav>

      {/* Top-right utilities — wide screens only. */}
      <div
        className={`absolute top-3 right-3 z-40 hidden gap-1.5 pt-[env(safe-area-inset-top)] sm:flex short:hidden ${immersive ? 'invisible opacity-0' : 'visible opacity-100'} transition-[opacity,visibility] duration-300 ${
          cameraMode && pipeline.active ? 'sb-on-video' : ''
        }`}
      >
        <UtilityButtons
          showDebug={cameraMode && pipeline.active}
          showRecord={mode === 'signs'}
          debugOpen={debugOpen}
          onToggleDebug={() => setDebugOpen((v) => !v)}
          onRecord={() => setSignRecorderOpen(true)}
          onSettings={() => setSettingsOpen(true)}
        />
      </div>

      {/* Main area. */}
      {/* pointer-events-none so a tap lands on the camera view beneath (which
          toggles the controls); each pane that needs input opts back in. */}
      <main id="main" className="pointer-events-none absolute inset-0 z-20">
        {showOnboarding && (
          <div className="sb-scroll pointer-events-auto h-full overflow-y-auto bg-[var(--sb-bg)]">
            <Onboarding
              onStart={() => {
                patch({ onboardingComplete: true });
                void pipeline.start();
              }}
              starting={pipeline.starting}
              error={pipeline.error}
              onRetry={() => void pipeline.start()}
            />
          </div>
        )}

        {mode === 'reverse' && (
          <div className="pointer-events-auto h-full bg-[var(--sb-bg)]">
            <ReverseMode />
          </div>
        )}

        {mode === 'conversation' && settings.experimental.conversationMode && (
          <div className="pointer-events-auto h-full bg-[var(--sb-bg)]/92">
            <ConversationMode />
          </div>
        )}

        {mode === 'signs' && pipeline.active && (
          <SignsMode
            recorderOpen={signRecorderOpen}
            onCloseRecorder={() => setSignRecorderOpen(false)}
            onTeachRef={teachSignRef}
          />
        )}

        {cameraMode && pipeline.active && mode !== 'conversation' && <Captions />}
      </main>

      {/* Bottom control bar — extreme edge, below the caption band. */}
      {cameraMode && pipeline.active && (
        <div
          ref={barRef}
          className={`sb-on-video sb-control-bar absolute inset-x-0 bottom-0 z-30 flex flex-col gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${immersive ? 'invisible opacity-0' : 'visible opacity-100'} transition-[opacity,visibility] duration-300`}
        >
          {/* One line, scrolled sideways if it overflows. Wrapping these made
              the bar grow by a row every time a fourth suggestion appeared,
              which pushed the captions up and moved the buttons under the
              thumb that was already reaching for them. */}
          <div className="sb-scroll flex items-center gap-2 overflow-x-auto empty:hidden">
            <SuggestionStrip onAccept={fingerspell.acceptSuggestion} />
            <Alternates
              related={mode === 'fingerspell' ? confusionOptions : []}
              onPick={(label) => {
                if (mode === 'signs') {
                  session.getState().replaceLastToken(label);
                  teachSignRef.current?.(label);
                } else {
                  fingerspell.pickAlternate(label);
                }
              }}
            />
          </div>
          <div className="flex items-center gap-3">
            {/* Capped: stretched across a desktop window the bar became a
                630px hairline, which reads as a progress bar for the page
                rather than a confidence meter for a letter. */}
            <div className="min-w-0 flex-1 sm:max-w-sm">
              <ConfidenceBar />
            </div>
            <Controls
              onBackspace={() => session.getState().backspace()}
              onSpace={fingerspell.commitSpace}
              onClear={() => session.getState().clearAll()}
              onSpeak={speakAll}
              onCorrect={() => setCorrectionOpen(true)}
              onExport={exportTranscript}
            />
          </div>
        </div>
      )}

      {fingerspell.taught && (
        <div
          role="status"
          style={{ bottom: `calc(var(--sb-bar-h, 6rem) + 0.75rem)` }}
          className="sb-panel sb-on-video absolute inset-x-3 z-40 mx-auto max-w-sm rounded-2xl px-4 py-2.5 text-center text-xs"
        >
          Learned your{' '}
          <span className="font-[family-name:var(--font-display)] font-bold">
            {fingerspell.taught.letter}
          </span>{' '}
          — {fingerspell.taught.samples} example
          {fingerspell.taught.samples === 1 ? '' : 's'}. A few more and it will stop confusing it.
        </div>
      )}

      {cameraMode && pipeline.active && !immersive && (
        <p
          aria-hidden="true"
          // Just above the bar it refers to, not floating at the top of the
          // frame where it landed on the framing guide's caption and read as
          // one garbled sentence. It fades after a few seconds either way.
          style={{ bottom: 'calc(var(--sb-bar-h, 6rem) + 0.35rem)' }}
          className="sb-immersive-hint pointer-events-none absolute inset-x-0 z-20 text-center text-[11px] text-white/55 sm:hidden"
        >
          Tap the view to clear the controls
        </p>
      )}

      {pipeline.error && pipeline.active && (
        <div role="alert" className="sb-on-video absolute inset-x-3 bottom-24 z-40 mx-auto max-w-md">
          <div className="sb-panel rounded-2xl border-[var(--color-alert)] p-3">
            <p className="text-sm font-semibold text-[var(--color-alert)]">{pipeline.error.message}</p>
            <p className="mt-1 text-xs text-[var(--sb-fg-muted)]">{pipeline.error.remedy}</p>
          </div>
        </div>
      )}

      <DebugPanel open={debugOpen} onClose={() => setDebugOpen(false)} samples={fingerspell.samples} />
      <CorrectionSheet open={correctionOpen} onClose={() => setCorrectionOpen(false)} />
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onRunCalibration={() => {
          setSettingsOpen(false);
          setCalibrating(STATIC_LETTERS);
        }}
        onFixFists={() => {
          setSettingsOpen(false);
          setCalibrating(FIST_CLUSTER);
        }}
        onManageSigns={() => {
          setSettingsOpen(false);
          patch({ recognition: { mode: 'signs' } });
          setSignRecorderOpen(true);
        }}
      />
      <UpdatePrompt />
      <CalibrationFlow
        open={calibrating !== null}
        letters={calibrating ?? STATIC_LETTERS}
        onClose={() => setCalibrating(null)}
        onFinished={() => void fingerspell.reloadCalibration()}
      />
    </div>
  );
}

/**
 * Publish an element's height as a CSS custom property on the document root.
 *
 * The control bar's height depends on what is in it, and the caption band has
 * to sit above it. Rather than pick an offset that is wrong in one direction or
 * the other, the bar measures itself and the captions read the number.
 */
function useMeasuredHeight(property: string) {
  // A callback ref rather than a plain one, so the effect re-runs when the bar
  // mounts and unmounts — which it does on every camera start and stop.
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (!el) {
      // Clear rather than leave a stale height from the last session behind.
      root.style.removeProperty(property);
      return;
    }
    const publish = () => root.style.setProperty(property, `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(property);
    };
  }, [el, property]);

  return setEl;
}

/**
 * Mode switcher. Rendered twice — as a left rail on wide screens and as a
 * horizontal strip on phones — from one definition, so the two cannot drift.
 */
function ModeButtons({
  mode,
  conversationEnabled,
  onPick,
  compact = false,
}: {
  mode: Mode;
  conversationEnabled: boolean;
  onPick(id: Mode): void;
  compact?: boolean;
}) {
  return (
    <>
      {MODES.map((m) => {
        const disabled = m.id === 'conversation' && !conversationEnabled;
        return (
          <button
            key={m.id}
            type="button"
            disabled={disabled}
            title={disabled ? 'Enable Conversation mode in Settings > Experimental' : m.label}
            // WCAG 2.5.3: the accessible name must contain the visible label,
            // so a voice-control user saying what they see actually works.
            aria-label={`${m.label} — ${m.short}`}
            aria-current={mode === m.id ? 'page' : undefined}
            onClick={() => onPick(m.id)}
            className={`sb-panel grid shrink-0 place-items-center rounded-xl font-semibold transition-colors disabled:opacity-30 ${
              // 44px tall on a phone, matching the utility buttons beside them.
              // They used to be 28px, which is both hard to hit and visibly a
              // different size from everything in the same row.
              compact ? 'h-11 px-3 text-xs' : 'h-12 w-[4.6rem] px-2 text-[11px]'
            } ${
              mode === m.id
                ? 'border-[var(--color-signal)] text-[var(--color-signal)]'
                : 'text-[var(--sb-fg-muted)] hover:text-[var(--sb-fg)]'
            }`}
          >
            {m.short}
          </button>
        );
      })}
    </>
  );
}

/**
 * Debug / record / settings. On phones these collapse to icons — three text
 * buttons plus four mode chips do not fit across 390px, and shrinking the text
 * until it does makes every one of them unreadable.
 */
function UtilityButtons({
  showDebug,
  showRecord,
  debugOpen,
  onToggleDebug,
  onRecord,
  onSettings,
  compact = false,
}: {
  showDebug: boolean;
  showRecord: boolean;
  debugOpen: boolean;
  onToggleDebug(): void;
  onRecord(): void;
  onSettings(): void;
  compact?: boolean;
}) {
  // 44px minimum touch target, per the platform accessibility guidance.
  // Drawn as SVG rather than as ⚙ / ◍ / ⏺: those are text glyphs, and which
  // font ends up rendering them — and at what weight and baseline — varies
  // enough between platforms that the row looked misaligned on half of them.
  const base = `sb-panel grid shrink-0 place-items-center rounded-xl font-medium ${
    compact ? 'h-11 w-11' : 'h-11 gap-2 px-3 text-xs [grid-auto-flow:column]'
  }`;
  return (
    <>
      {showDebug && (
        <button
          type="button"
          onClick={onToggleDebug}
          aria-pressed={debugOpen}
          aria-label="Debug"
          title="Debug (D)"
          className={base}
        >
          <Icon d="M12 3a4 4 0 0 1 4 4v1H8V7a4 4 0 0 1 4-4Zm-6 8h12M5 15h2m10 0h2M6 8h12v5a6 6 0 0 1-12 0V8Z" />
          {!compact && 'Debug'}
        </button>
      )}
      {showRecord && (
        <button
          type="button"
          onClick={onRecord}
          aria-label="Record sign"
          title="Record sign"
          className={base}
        >
          <Icon d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" />
          {!compact && 'Record sign'}
        </button>
      )}
      <button
        type="button"
        onClick={onSettings}
        aria-label="Settings"
        title="Settings (,)"
        className={base}
      >
        <Icon d="M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm7.4 2.5c0 .5-.05.9-.1 1.4l1.7 1.3-1.7 3-2-.8c-.7.6-1.5 1-2.3 1.3l-.3 2.1h-3.4l-.3-2.1c-.8-.3-1.6-.7-2.3-1.3l-2 .8-1.7-3 1.7-1.3a8 8 0 0 1 0-2.8L3 9.3l1.7-3 2 .8c.7-.6 1.5-1 2.3-1.3l.3-2.1h3.4l.3 2.1c.8.3 1.6.7 2.3 1.3l2-.8 1.7 3-1.7 1.3c.05.5.1.9.1 1.4Z" />
        {!compact && 'Settings'}
      </button>
    </>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[1.15rem] w-[1.15rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
