import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Extrait l'audio d'une vidéo en MP3 via FFmpeg en streaming.
 * Utilise les streams Node.js pour éviter d'écrire un fichier temporaire sur disque.
 *
 * @param videoPath - Chemin vers le fichier vidéo source
 * @returns Readable stream de l'audio MP3
 */
export async function extractAudioToMp3Stream(videoPath: string): Promise<Readable> {
  // Vérifier que le fichier existe
  const { access } = await import('node:fs/promises');
  await access(videoPath);

  // Lancer FFmpeg en streaming
  // -i : input
  // -vn : pas de vidéo
  // -acodec libmp3lame : encodeur MP3
  // -ab 128k : bitrate 128kbps
  // -ar 16000 : sample rate 16kHz (optimal pour Deepgram)
  // -ac 1 : mono
  // -f mp3 : format output MP3
  // pipe:1 : sortie sur stdout
  const ffmpeg = execFileAsync('ffmpeg', [
    '-i', videoPath,
    '-vn',
    '-acodec', 'libmp3lame',
    '-ab', '128k',
    '-ar', '16000',
    '-ac', '1',
    '-f', 'mp3',
    'pipe:1'
  ], {
    maxBuffer: 1024 * 1024 * 100, // 100MB buffer
    timeout: 300000 // 5 minutes timeout
  });

  // Retourner le stdout comme stream lisible
  return ffmpeg.stdout as unknown as Readable;
}

/**
 * Obtient la durée d'une vidéo via ffprobe
 * @param videoPath - Chemin vers le fichier vidéo
 * @returns Durée en secondes
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath
  ]);

  return parseFloat(stdout.trim());
}

/**
 * Obtient les métadonnées vidéo (width, height, fps)
 * @param videoPath - Chemin vers le fichier vidéo
 */
export async function getVideoMetadata(videoPath: string): Promise<{
  width: number;
  height: number;
  fps: number;
}> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath
  ]);

  const lines = stdout.trim().split('\n');
  const width = parseInt(lines[0], 10);
  const height = parseInt(lines[1], 10);
  const [num, den] = lines[2].split('/').map(Number);
  const fps = num / den;

  return { width, height, fps };
}