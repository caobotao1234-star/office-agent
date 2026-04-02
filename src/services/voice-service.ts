/**
 * VoiceService — Voice recording and speech-to-text interface layer.
 *
 * Task 19.1: startRecording/stopRecording, transcribe, stream transcription,
 *            checkAvailability, needsConfirmation on low confidence.
 *
 * Actual STT API calls are left as stubs — concrete implementations
 * will be provided when a specific STT provider is integrated.
 *
 * Requirements: 19.1-19.5
 */

/** Raw audio data placeholder. */
export type AudioBuffer = Uint8Array;

export interface TranscriptionResult {
  text: string;
  confidence: number;
  /** True when confidence is below the threshold — user should confirm. */
  needsConfirmation: boolean;
}

export interface VoiceAvailability {
  available: boolean;
  reason?: string;
}

/** Confidence below this value triggers needsConfirmation. */
const CONFIDENCE_THRESHOLD = 0.7;

export class VoiceService {
  private recording = false;
  private audioChunks: Uint8Array[] = [];

  // ----------------------------------------------------------
  // Recording control
  // ----------------------------------------------------------

  /**
   * Start capturing audio.
   * The provided AbortSignal can be used to cancel recording externally.
   */
  async startRecording(signal: AbortSignal): Promise<void> {
    if (this.recording) throw new Error('Already recording');

    this.recording = true;
    this.audioChunks = [];

    // Listen for external abort
    signal.addEventListener('abort', () => {
      this.recording = false;
    }, { once: true });

    // Stub: In a real implementation this would open a mic stream.
  }

  /**
   * Stop recording and return the captured audio buffer.
   */
  stopRecording(): AudioBuffer {
    if (!this.recording) throw new Error('Not recording');

    this.recording = false;

    // Stub: merge captured chunks into a single buffer
    const total = this.audioChunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.audioChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.audioChunks = [];
    return merged;
  }

  // ----------------------------------------------------------
  // Transcription
  // ----------------------------------------------------------

  /**
   * Transcribe an audio buffer to text.
   * Stub: returns a placeholder result. Replace with real STT call.
   */
  async transcribe(audio: AudioBuffer): Promise<TranscriptionResult> {
    // Stub implementation — real STT API call goes here
    const text = '';
    const confidence = 0;

    return {
      text,
      confidence,
      needsConfirmation: confidence < CONFIDENCE_THRESHOLD,
    };
  }

  /**
   * Start streaming transcription — partial results are delivered
   * via the `onPartial` callback as they arrive.
   * Stub: no-op in the current implementation.
   */
  startStreamTranscription(onPartial: (text: string) => void): void {
    // Stub: In a real implementation this would open a streaming
    // STT session and call onPartial with incremental results.
    void onPartial;
  }

  // ----------------------------------------------------------
  // State & availability
  // ----------------------------------------------------------

  isRecording(): boolean {
    return this.recording;
  }

  /**
   * Check whether voice input is available on the current platform.
   * Stub: always returns unavailable until a real STT provider is wired.
   */
  async checkAvailability(): Promise<VoiceAvailability> {
    // Stub — replace with actual platform / API key check
    return {
      available: false,
      reason: 'STT provider not configured',
    };
  }
}

/**
 * Helper: build a TranscriptionResult and flag needsConfirmation
 * when confidence is below the threshold.
 * Useful for concrete STT implementations.
 */
export function buildTranscriptionResult(
  text: string,
  confidence: number,
): TranscriptionResult {
  return {
    text,
    confidence,
    needsConfirmation: confidence < CONFIDENCE_THRESHOLD,
  };
}
