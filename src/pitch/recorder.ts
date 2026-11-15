/**
 * In-browser recording of the pitch: captures this tab (the 3-D canvas AND
 * every HTML overlay, which canvas.captureStream alone would miss) with
 * getDisplayMedia, adds the procedural pitch audio, and records it with
 * MediaRecorder to WebM. The browser asks the user which tab to share; with
 * `preferCurrentTab` it offers this one. scripts/record-pitch-video.ts runs
 * the same code headed with the capture auto-accepted.
 */
import { pitchAudioStream } from './pitchAudio';

export const PITCH_FILE = 'gisat-lunar-navigator-pitch-3min';

export interface PitchRecording {
  stop: () => Promise<Blob>;
  mime: string;
}

function pickMime(): string {
  const options = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
}

export async function startTabRecording(fps = 60): Promise<PitchRecording> {
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: fps, max: fps }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
  } as DisplayMediaStreamOptions);
  const tracks = [...display.getVideoTracks()];
  const audio = pitchAudioStream();
  if (audio) tracks.push(...audio.getAudioTracks());
  const stream = new MediaStream(tracks);
  const mime = pickMime();
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(1000);
  return {
    mime,
    stop: () => new Promise<Blob>((resolve) => {
      rec.onstop = () => { display.getTracks().forEach((t) => t.stop()); resolve(new Blob(chunks, { type: 'video/webm' })); };
      rec.stop();
    }),
  };
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
