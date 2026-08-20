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

export default function App() {
  return (
    <PipelineProvider>
      <Shell />
    </PipelineProvider>
  );
}

const MODES: { id: Mode; label: string; short: string }[] = [
  { id: 'fingerspell', label: 'Fingerspell', short: 'A·B·C' },
  { id: 'signs', label: 'Signs', short: 'Signs' },
  { id: 'conversation', label: 'Conversation', short: 'Talk' },
  { id: 'reverse', label: 'Reverse', short: 'Text→ASL' },
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
  const [calibrationOpen, setCalibrationOpen] = useState(false);
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
          {settings.camera.framingGuide && <FramingGuide />}
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
              showDebug={cameraMode && pipeline.active}
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
          className={`sb-on-video sb-control-bar absolute inset-x-0 bottom-0 z-30 flex flex-col gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${immersive ? 'invisible opacity-0' : 'visible opacity-100'} transition-[opacity,visibility] duration-300`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SuggestionStrip onAccept={fingerspell.acceptSuggestion} />
            <Alternates
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-52 flex-1">
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

      {cameraMode && pipeline.active && !immersive && (
        <p
          aria-hidden="true"
          className="sb-immersive-hint pointer-events-none absolute inset-x-0 bottom-[7.5rem] z-20 text-center text-[11px] text-white/55 sm:hidden"
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
          setCalibrationOpen(true);
        }}
        onManageSigns={() => {
          setSettingsOpen(false);
          patch({ recognition: { mode: 'signs' } });
          setSignRecorderOpen(true);
        }}
      />
      <UpdatePrompt />
      <CalibrationFlow
        open={calibrationOpen}
        onClose={() => setCalibrationOpen(false)}
        onFinished={() => void fingerspell.reloadCalibration()}
      />
    </div>
  );
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
            className={`sb-panel shrink-0 rounded-xl font-semibold transition-colors disabled:opacity-30 ${
              compact ? 'px-2.5 py-1.5 text-[11px]' : 'w-[4.4rem] px-2 py-2.5 text-[11px]'
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
  const base = `sb-panel shrink-0 rounded-xl font-medium ${
    compact ? 'grid h-11 w-11 place-items-center text-base' : 'px-3 py-2 text-xs'
  }`;
  return (
    <>
      {showDebug && (
        <button
          type="button"
          onClick={onToggleDebug}
          aria-pressed={debugOpen}
          aria-label="Debug"
          className={base}
        >
          {compact ? '◍' : 'Debug'}
        </button>
      )}
      {showRecord && (
        <button type="button" onClick={onRecord} aria-label="Record sign" className={base}>
          {compact ? '⏺' : 'Record sign'}
        </button>
      )}
      <button type="button" onClick={onSettings} aria-label="Settings" className={base}>
        {compact ? '⚙' : 'Settings'}
      </button>
    </>
  );
}
