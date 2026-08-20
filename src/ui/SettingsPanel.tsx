/**
 * Settings.
 *
 * Grouped the way somebody troubleshooting would look for things, not the way
 * the code is organised. Recognition first, because that is what people come
 * here to fix - dwell time and confidence threshold are the two dials that turn
 * a frustrating session into a usable one.
 *
 * "On-device only" is shown locked on. It is not a preference.
 */
import { useEffect, useState } from 'react';
import { useSettings } from '@/store';
import { usePipeline } from '@/vision/pipeline';
import { RANGES, clampToRange } from '@/settings/schema';
import type { Backend, CaptionPosition, CaptionSize, DominantHand, FontChoice, OverlayMode, ReadAloud, Theme } from '@/settings/schema';
import { ActionRow, Choice, Section, Select, Slider, Toggle } from './form';
import { DisclaimerLong } from './Disclaimer';
import { getVoices, whenVoicesReady } from '@/speech/tts';
import { clearCalibration, deleteAllData, exportAll, listCustomSigns } from '@/db/idb';
import { hardReset } from '@/pwa';
import { sttSupported } from '@/speech/stt';

export function SettingsPanel({
  open,
  onClose,
  onRunCalibration,
  onManageSigns,
}: {
  open: boolean;
  onClose(): void;
  onRunCalibration(): void;
  onManageSigns(): void;
}) {
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);
  const reset = useSettings((s) => s.resetToDefaults);
  const { devices, delegate } = usePipeline();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [customSignCount, setCustomSignCount] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    void whenVoicesReady().then(setVoices);
    void listCustomSigns().then((s) => setCustomSignCount(s.length));
    setConfirmDelete(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const voiceOptions = [
    { value: '', label: 'System default' },
    ...(voices.length ? voices : getVoices()).map((v) => ({
      value: v.voiceURI,
      label: `${v.name} (${v.lang})`,
    })),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sb-scroll h-full w-full max-w-md overflow-y-auto bg-[var(--sb-bg)] px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:border-l sm:border-[var(--sb-panel-edge)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Done, close settings"
            className="rounded-lg border border-[var(--sb-panel-edge)] px-3 py-1.5 text-sm hover:border-[var(--color-signal)]"
          >
            Done
          </button>
        </div>

        <Section
          title="Recognition"
          description="Dwell time and the confidence threshold are the two dials worth learning. Longer dwell means fewer wrong letters and slower spelling."
        >
          <Choice<DominantHand>
            label="Dominant hand"
            value={settings.recognition.dominantHand}
            options={[
              { value: 'right', label: 'Right' },
              { value: 'left', label: 'Left' },
              { value: 'auto', label: 'Detect' },
            ]}
            onChange={(dominantHand) => patch({ recognition: { dominantHand } })}
          />
          <Toggle
            label="Track both hands"
            hint="Needed for two-handed signs. Costs a few milliseconds per frame."
            checked={settings.recognition.twoHanded}
            onChange={(twoHanded) => patch({ recognition: { twoHanded } })}
          />
          <Slider
            label="Confidence threshold"
            hint="Below this, nothing is committed. Raising it trades missed letters for wrong ones."
            value={settings.recognition.confidenceThreshold}
            {...RANGES.confidenceThreshold}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) =>
              patch({ recognition: { confidenceThreshold: clampToRange('confidenceThreshold', v) } })
            }
          />
          <Slider
            label="Dwell time to commit"
            hint="How long a letter must be held steady before it is written."
            value={settings.recognition.dwellMs}
            {...RANGES.dwellMs}
            format={(v) => `${v} ms`}
            onChange={(v) => patch({ recognition: { dwellMs: clampToRange('dwellMs', v) } })}
          />
          <Slider
            label="Auto-space gap"
            hint="Drop your hand or move it out of frame for this long to insert a space."
            value={settings.recognition.autoSpaceMs}
            {...RANGES.autoSpaceMs}
            format={(v) => `${v} ms`}
            onChange={(v) => patch({ recognition: { autoSpaceMs: clampToRange('autoSpaceMs', v) } })}
          />
          <Select
            label="Hand steadiness"
            hint="Filters jitter out of the tracked hand before anything reads it. Stronger holds a still hand rock steady; lighter follows fast movement more closely."
            value={settings.recognition.landmarkSmoothing}
            options={[
              { value: 'off', label: 'Off — raw tracking' },
              { value: 'light', label: 'Light' },
              { value: 'standard', label: 'Standard' },
              { value: 'strong', label: 'Strong' },
            ]}
            onChange={(landmarkSmoothing) => patch({ recognition: { landmarkSmoothing } })}
          />
          <Slider
            label="Smoothing window"
            hint="Frames of evidence averaged before a letter can start committing. Higher is steadier and slower to react."
            value={settings.recognition.smoothingWindow}
            {...RANGES.smoothingWindow}
            format={(v) => `${v} frame${v === 1 ? '' : 's'}`}
            onChange={(v) =>
              patch({ recognition: { smoothingWindow: clampToRange('smoothingWindow', v) } })
            }
          />
          <Toggle
            label="Word prediction"
            hint="Suggests completions as letters accumulate, including fixes for commonly confused letters."
            checked={settings.recognition.wordPrediction}
            onChange={(wordPrediction) => patch({ recognition: { wordPrediction } })}
          />
          <ActionRow
            label="Calibration"
            hint="Record your own letters. This is the single biggest accuracy improvement available, and it takes about four minutes."
            action="Run"
            onClick={onRunCalibration}
          />
          <ActionRow
            label="Reset calibration"
            hint="Deletes your recorded samples and the model fitted from them."
            action="Reset"
            destructive
            onClick={() => void clearCalibration()}
          />
          <ActionRow
            label="Custom signs"
            hint={`${customSignCount} recorded. Add your name sign, local signs, or jargon.`}
            action="Manage"
            onClick={onManageSigns}
          />
        </Section>

        <Section title="Camera">
          <Select
            label="Camera"
            value={settings.camera.deviceId ?? ''}
            options={[
              { value: '', label: 'Default camera' },
              ...devices.map((d) => ({ value: d.deviceId, label: d.label })),
            ]}
            onChange={(deviceId) => patch({ camera: { deviceId: deviceId || null } })}
          />
          <Choice
            label="Resolution"
            value={`${settings.camera.width}x${settings.camera.height}`}
            options={[
              { value: '640x480', label: '640×480' },
              { value: '1280x720', label: '1280×720' },
              { value: '1920x1080', label: '1920×1080' },
            ]}
            onChange={(value) => {
              const [width, height] = value.split('x').map(Number);
              patch({ camera: { width, height } });
            }}
          />
          <Slider
            label="Target frame rate"
            value={settings.camera.targetFps}
            {...RANGES.targetFps}
            format={(v) => `${v} fps`}
            onChange={(v) => patch({ camera: { targetFps: clampToRange('targetFps', v) } })}
          />
          <Toggle
            label="Mirror preview"
            hint="On by default. Recognition is unaffected either way."
            checked={settings.camera.mirror}
            onChange={(mirror) => patch({ camera: { mirror } })}
          />
          <Choice<OverlayMode>
            label="Landmark overlay"
            value={settings.camera.overlay}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'hands', label: 'Hands' },
              { value: 'hands+pose', label: 'Hands + pose' },
              { value: 'debug', label: 'Debug' },
            ]}
            onChange={(overlay) => patch({ camera: { overlay } })}
          />
          <Toggle
            label="Framing guide"
            hint="Shows where hands track reliably."
            checked={settings.camera.framingGuide}
            onChange={(framingGuide) => patch({ camera: { framingGuide } })}
          />
        </Section>

        <Section title="Speech output">
          <Choice<ReadAloud>
            label="Read aloud"
            value={settings.speechOut.readAloud}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'letter', label: 'Per letter' },
              { value: 'word', label: 'Per word' },
              { value: 'sentence', label: 'Per sentence' },
            ]}
            onChange={(readAloud) => patch({ speechOut: { readAloud } })}
          />
          <Select
            label="Voice"
            value={settings.speechOut.voiceURI ?? ''}
            options={voiceOptions}
            onChange={(voiceURI) => patch({ speechOut: { voiceURI: voiceURI || null } })}
          />
          <Slider
            label="Rate"
            value={settings.speechOut.rate}
            {...RANGES.rate}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(rate) => patch({ speechOut: { rate } })}
          />
          <Slider
            label="Pitch"
            value={settings.speechOut.pitch}
            {...RANGES.pitch}
            format={(v) => v.toFixed(2)}
            onChange={(pitch) => patch({ speechOut: { pitch } })}
          />
          <Slider
            label="Volume"
            value={settings.speechOut.volume}
            {...RANGES.volume}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(volume) => patch({ speechOut: { volume } })}
          />
          <Toggle
            label="Speak only above the confidence threshold"
            hint="Stops the app saying words out loud that it is not sure about."
            checked={settings.speechOut.onlyAboveThreshold}
            onChange={(onlyAboveThreshold) => patch({ speechOut: { onlyAboveThreshold } })}
          />
          <Toggle
            label="Infer punctuation"
            hint="Capitalises sentences and adds a final full stop. It does not guess question marks."
            checked={settings.speechOut.punctuationInference}
            onChange={(punctuationInference) => patch({ speechOut: { punctuationInference } })}
          />
        </Section>

        <Section
          title="Speech input"
          description={
            sttSupported()
              ? 'Used in Reverse mode. In Chrome and Edge, browser speech recognition sends audio to a remote service — typed input never leaves your device.'
              : 'This browser has no speech recognition. Reverse mode accepts typed input.'
          }
        >
          <Select
            label="Language"
            value={settings.speechIn.language}
            options={[
              { value: 'en-US', label: 'English (US)' },
              { value: 'en-GB', label: 'English (UK)' },
              { value: 'en-CA', label: 'English (Canada)' },
              { value: 'en-AU', label: 'English (Australia)' },
            ]}
            onChange={(language) => patch({ speechIn: { language } })}
          />
          <Toggle
            label="Push to talk"
            hint="Off means the microphone listens continuously while Reverse mode is open."
            checked={settings.speechIn.pushToTalk}
            onChange={(pushToTalk) => patch({ speechIn: { pushToTalk } })}
          />
          <Toggle
            label="Show interim results"
            checked={settings.speechIn.interimResults}
            onChange={(interimResults) => patch({ speechIn: { interimResults } })}
          />
        </Section>

        <Section title="Display">
          <Choice<CaptionSize>
            label="Caption size"
            value={settings.display.captionSize}
            options={[
              { value: 's', label: 'S' },
              { value: 'm', label: 'M' },
              { value: 'l', label: 'L' },
              { value: 'xl', label: 'XL' },
              { value: 'huge', label: 'Huge' },
            ]}
            onChange={(captionSize) => patch({ display: { captionSize } })}
          />
          <Choice<CaptionPosition>
            label="Caption position"
            value={settings.display.captionPosition}
            options={[
              { value: 'bottom', label: 'Bottom' },
              { value: 'top', label: 'Top' },
              { value: 'side', label: 'Side panel' },
            ]}
            onChange={(captionPosition) => patch({ display: { captionPosition } })}
          />
          <Choice<FontChoice>
            label="Font"
            hint="OpenDyslexic must be installed on your device; otherwise this falls back to a legible sans."
            value={settings.display.font}
            options={[
              { value: 'display', label: 'Display' },
              { value: 'system', label: 'System' },
              { value: 'dyslexic', label: 'OpenDyslexic' },
            ]}
            onChange={(font) => patch({ display: { font } })}
          />
          <Choice<Theme>
            label="Theme"
            value={settings.display.theme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'contrast', label: 'High contrast' },
            ]}
            onChange={(theme) => patch({ display: { theme } })}
          />
          <Toggle
            label="Show confidence bar"
            checked={settings.display.showConfidenceBar}
            onChange={(showConfidenceBar) => patch({ display: { showConfidenceBar } })}
          />
          <Toggle
            label="Show top-3 alternates"
            checked={settings.display.showAlternates}
            onChange={(showAlternates) => patch({ display: { showAlternates } })}
          />
          <Toggle
            label="Reduce motion"
            hint="Also respected automatically when your system asks for reduced motion."
            checked={settings.display.reducedMotion}
            onChange={(reducedMotion) => patch({ display: { reducedMotion } })}
          />
        </Section>

        <Section
          title="Performance"
          description={delegate ? `Landmark extraction is running on ${delegate}.` : undefined}
        >
          <Choice<Backend>
            label="Inference backend"
            hint="Auto probes WebGPU, then WebGL, then WASM. Switch to WASM if you see visual glitches."
            value={settings.performance.backend}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'webgpu', label: 'WebGPU' },
              { value: 'webgl', label: 'WebGL' },
              { value: 'wasm', label: 'WASM' },
            ]}
            onChange={(backend) => patch({ performance: { backend } })}
          />
          <Toggle
            label="Power saving"
            hint="Halves the capture rate. Noticeably longer battery life, slightly laggier captions."
            checked={settings.performance.powerSaving}
            onChange={(powerSaving) => patch({ performance: { powerSaving } })}
          />
          <Choice
            label="Model precision"
            value={settings.performance.precision}
            options={[
              { value: 'full', label: 'Full' },
              { value: 'quantized', label: 'Quantized' },
            ]}
            onChange={(precision) => patch({ performance: { precision: precision as 'full' | 'quantized' } })}
          />
        </Section>

        <Section
          title="Privacy"
          description="Video, landmarks and transcripts stay on this device. There is no server to send them to."
        >
          <Toggle label="On-device only" hint="Locked on." checked disabled onChange={() => {}} />
          <Toggle
            label="Save transcripts on this device"
            hint="Stored in your browser's local database. Never uploaded."
            checked={settings.privacy.saveTranscripts}
            onChange={(saveTranscripts) => patch({ privacy: { saveTranscripts } })}
          />
          <Slider
            label="Delete transcripts after"
            value={settings.privacy.autoDeleteAfterDays}
            {...RANGES.autoDeleteAfterDays}
            format={(v) => (v === 0 ? 'Never' : `${v} day${v === 1 ? '' : 's'}`)}
            onChange={(autoDeleteAfterDays) => patch({ privacy: { autoDeleteAfterDays } })}
          />
          <ActionRow
            label="Export all data"
            hint="Everything this app has stored, as a JSON file."
            action="Export"
            onClick={async () => {
              const bundle = await exportAll();
              downloadFile(
                `signbridge-data-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(bundle, null, 2),
                'application/json',
              );
            }}
          />
          <ActionRow
            label="Delete all data"
            hint={
              confirmDelete
                ? 'This erases settings, calibration, custom signs and transcripts. It cannot be undone.'
                : 'Erases everything stored on this device.'
            }
            action={confirmDelete ? 'Confirm delete' : 'Delete'}
            destructive
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              await deleteAllData();
              window.location.reload();
            }}
          />
        </Section>

        <Section title="Accessibility">
          <Toggle
            label="Vibrate on commit"
            hint="Mobile only, where the browser supports it."
            checked={settings.accessibility.hapticOnCommit}
            onChange={(hapticOnCommit) => patch({ accessibility: { hapticOnCommit } })}
          />
          <Toggle
            label="Sound on commit"
            checked={settings.accessibility.audioCueOnCommit}
            onChange={(audioCueOnCommit) => patch({ accessibility: { audioCueOnCommit } })}
          />
        </Section>

        <Section
          title="Experimental"
          description="Off by default and honestly labelled. These do not work well yet."
        >
          <Toggle
            label="Conversation mode"
            hint="Continuous signing to English sentences. This is an open research problem; expect it to fail on anything but short, clear, in-vocabulary sentences."
            checked={settings.experimental.conversationMode}
            onChange={(conversationMode) => patch({ experimental: { conversationMode } })}
          />
          <Toggle
            label="Avatar output in Reverse mode"
            hint="There is no open, production-quality ASL avatar. Anything shown here will look uncanny."
            checked={settings.experimental.avatarOutput}
            onChange={(avatarOutput) => patch({ experimental: { avatarOutput } })}
          />
        </Section>

        <Section title="About">
          <DisclaimerLong />
          <ActionRow
            label="Reload the app from scratch"
            hint="Clears the cached copy of the app and downloads it again. Use this if an update does not seem to have arrived, or if something is broken after one. Your settings, calibration and transcripts are kept."
            action="Reload"
            onClick={() => void hardReset()}
          />
          <ActionRow
            label="Reset all settings"
            action="Reset"
            destructive
            onClick={reset}
            hint="Returns every setting to its default. Calibration and transcripts are kept."
          />
        </Section>
      </div>
    </div>
  );
}

export function downloadFile(filename: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
