/**
 * Speech-to-Text Service — 语音转文字
 *
 * 使用 DashScope 的 Paraformer 模型进行语音识别。
 * DashScope 兼容 OpenAI 的 /v1/audio/transcriptions 接口。
 *
 * 支持格式：ogg, opus, mp3, wav, m4a, flac
 */

const DASHSCOPE_STT_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions';

export interface STTResult {
  text: string;
  success: boolean;
  error?: string;
}

/**
 * Transcribe audio buffer to text using DashScope Paraformer.
 * @param audioBuffer - Raw audio file bytes
 * @param apiKey - DashScope API key (same as chat API key)
 * @param fileName - Original filename with extension (for format detection)
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  apiKey: string,
  fileName = 'audio.ogg',
): Promise<STTResult> {
  try {
    // Build multipart form data manually (no external dependency)
    const boundary = '----FormBoundary' + Date.now().toString(36);

    const parts: Buffer[] = [];

    // File part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    ));
    parts.push(audioBuffer);
    parts.push(Buffer.from('\r\n'));

    // Model part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `paraformer-v2\r\n`
    ));

    // Language part (Chinese)
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language"\r\n\r\n` +
      `zh\r\n`
    ));

    // End boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const response = await fetch(DASHSCOPE_STT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      return { text: '', success: false, error: `STT API error ${response.status}: ${errorText}` };
    }

    const data = await response.json() as { text?: string; error?: { message?: string } };

    if (data.error) {
      return { text: '', success: false, error: `STT: ${data.error.message}` };
    }

    return { text: data.text ?? '', success: true };
  } catch (err) {
    return { text: '', success: false, error: `STT failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
