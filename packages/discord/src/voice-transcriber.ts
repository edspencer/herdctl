/**
 * Voice message transcription using OpenAI Whisper API
 *
 * Transcribes audio buffers to text using the OpenAI audio transcription endpoint.
 * Uses native fetch + FormData (Node 18+), no additional npm dependencies required.
 *
 * @module voice-transcriber
 */

export interface TranscribeOptions {
  /** OpenAI API key */
  apiKey: string;
  /** Whisper model to use (default: "whisper-1") */
  model?: string;
  /** Language hint for better accuracy (ISO 639-1, e.g., "en") */
  language?: string;
}

export interface TranscribeResult {
  /** The transcribed text */
  text: string;
}

/**
 * Transcribe an audio buffer using the OpenAI Whisper API
 *
 * @param audioBuffer - The audio file contents as a Buffer
 * @param filename - Original filename (used for content-type detection)
 * @param options - Transcription options including API key and model
 * @returns The transcription result with text
 * @throws Error if the API call fails
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  options: TranscribeOptions,
): Promise<TranscribeResult> {
  const model = options.model ?? "whisper-1";

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer]), filename);
  formData.append("model", model);
  if (options.language) {
    formData.append("language", options.language);
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: formData,
    signal: AbortSignal.timeout(60_000), // 60s timeout for transcription API
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "unknown error");
    throw new Error(`OpenAI Whisper API error (${response.status}): ${errorBody}`);
  }

  const result = (await response.json()) as Record<string, unknown>;
  if (typeof result.text !== "string") {
    throw new Error("OpenAI Whisper API returned an unexpected response (missing 'text' field)");
  }
  return { text: result.text };
}
