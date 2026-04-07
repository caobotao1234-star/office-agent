/**
 * Speech-to-Text Service — 语音转文字
 *
 * 使用 DashScope Paraformer 文件转写 API。
 * 流程：提交转写任务 → 轮询结果（短音频通常几秒完成）
 *
 * 支持格式：ogg, opus, mp3, wav, m4a, flac, pcm
 */

const DASHSCOPE_TASK_URL = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';
const DASHSCOPE_TASK_QUERY_URL = 'https://dashscope.aliyuncs.com/api/v1/tasks';

export interface STTResult {
  text: string;
  success: boolean;
  error?: string;
}

/**
 * Transcribe audio buffer to text using DashScope Paraformer.
 * Uses the file transcription async API with polling.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  apiKey: string,
  fileName = 'audio.opus',
): Promise<STTResult> {
  try {
    // For DashScope file transcription, we need a file URL.
    // Since we have a buffer, we'll use the OpenAI-compatible whisper endpoint first,
    // and fall back to base64 inline if needed.

    // Try OpenAI-compatible endpoint (some DashScope regions support it)
    const compatResult = await tryOpenAICompat(audioBuffer, apiKey, fileName);
    if (compatResult.success) return compatResult;

    // Fallback: use Paraformer real-time via HTTP (sensevoice model supports direct audio)
    const senseResult = await trySenseVoice(audioBuffer, apiKey);
    if (senseResult.success) return senseResult;

    return { text: '', success: false, error: '所有STT方案均失败' };
  } catch (err) {
    return { text: '', success: false, error: `STT failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Try OpenAI-compatible /v1/audio/transcriptions */
async function tryOpenAICompat(audioBuffer: Buffer, apiKey: string, fileName: string): Promise<STTResult> {
  try {
    const boundary = '----FormBoundary' + Date.now().toString(36);
    const parts: Buffer[] = [];

    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    ));
    parts.push(audioBuffer);
    parts.push(Buffer.from('\r\n'));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nparaformer-v2\r\n`));
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) return { text: '', success: false, error: `compat ${response.status}` };
    const data = await response.json() as any;
    if (data.text) return { text: data.text, success: true };
    return { text: '', success: false, error: 'no text in response' };
  } catch {
    return { text: '', success: false, error: 'compat failed' };
  }
}

/** Try SenseVoice model via DashScope API (supports direct audio input) */
async function trySenseVoice(audioBuffer: Buffer, apiKey: string): Promise<STTResult> {
  try {
    const base64Audio = audioBuffer.toString('base64');

    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: 'sensevoice-v1',
        input: {
          file_urls: [`data:audio/ogg;base64,${base64Audio}`],
        },
        parameters: {
          language_hints: ['zh'],
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { text: '', success: false, error: `sensevoice submit ${response.status}: ${errText.slice(0, 200)}` };
    }

    const submitData = await response.json() as any;
    const taskId = submitData?.output?.task_id;
    if (!taskId) {
      return { text: '', success: false, error: `no task_id: ${JSON.stringify(submitData).slice(0, 200)}` };
    }

    // Poll for result (max 30 seconds)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));

      const pollRes = await fetch(`${DASHSCOPE_TASK_QUERY_URL}/${taskId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!pollRes.ok) continue;
      const pollData = await pollRes.json() as any;
      const status = pollData?.output?.task_status;

      if (status === 'SUCCEEDED') {
        const results = pollData?.output?.results;
        if (results && results.length > 0) {
          // Download transcription result
          const transcriptionUrl = results[0].transcription_url;
          if (transcriptionUrl) {
            const transRes = await fetch(transcriptionUrl);
            const transData = await transRes.json() as any;
            const text = transData?.transcripts?.[0]?.text ??
                         transData?.transcripts?.map((t: any) => t.text).join('') ?? '';
            if (text) return { text, success: true };
          }
        }
        return { text: '', success: false, error: 'transcription succeeded but no text' };
      }

      if (status === 'FAILED') {
        return { text: '', success: false, error: `task failed: ${pollData?.output?.message ?? 'unknown'}` };
      }
    }

    return { text: '', success: false, error: 'polling timeout (30s)' };
  } catch (err) {
    return { text: '', success: false, error: `sensevoice failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
