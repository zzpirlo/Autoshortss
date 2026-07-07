import { Readable } from 'node:stream';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { generateAssSubtitles, type TimedWord } from '@/lib/subtitleGenerator';

const execFileAsync = promisify(execFile);

/**
 * Extrait l'audio d'une vidéo en MP3 via FFmpeg.
 *
 * Le flux FFmpeg est écrit dans un fichier temporaire dans `os.tmpdir()` puis
 * relu intégralement sous forme de Buffer. On attend explicitement la fin du
 * processus (`close`) ET la fin de l'écriture (`pipeline`) avant de résoudre,
 * ce qui garantit un MP3 complet et non tronqué — condition indispensable pour
 * que Deepgram accepte le fichier (sinon erreur 400 "corrupt or unsupported data").
 *
 * @param videoPath - Chemin vers le fichier vidéo source
 * @returns Buffer MP3 complet (16kHz, mono)
 */
export async function extractAudioToMp3(videoPath: string): Promise<Buffer> {
  // Vérifier que le fichier existe
  const { access } = await import('node:fs/promises');
  await access(videoPath);

  const tmpPath = join(tmpdir(), `autoshortss-audio-${randomUUID()}.mp3`);
  const output = createWriteStream(tmpPath);

  // Lancer FFmpeg
  // -i : input
  // -vn : pas de vidéo
  // -acodec libmp3lame : encodeur MP3
  // -ab 128k : bitrate 128kbps
  // -ar 16000 : sample rate 16kHz (optimal pour Deepgram)
  // -ac 1 : mono
  // -f mp3 : format output MP3
  // pipe:1 : sortie sur stdout (redirigée vers le fichier temporaire)
  const ffmpeg = spawn('ffmpeg', [
    '-i', videoPath,
    '-vn',
    '-acodec', 'libmp3lame',
    '-ab', '128k',
    '-ar', '16000',
    '-ac', '1',
    '-f', 'mp3',
    'pipe:1'
  ]);

  // Rediriger stdout vers le fichier temporaire
  const writeDone = pipeline(ffmpeg.stdout, output);

  // Capturer stderr pour le diagnostic en cas d'échec
  const stderrChunks: Buffer[] = [];
  ffmpeg.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));

  // Attendre BOTH : la fin du processus FFmpeg et la complétion de l'écriture.
  const [exitCode] = await Promise.all([
    new Promise<number | null>((resolve, reject) => {
      ffmpeg.on('close', (code) => resolve(code));
      ffmpeg.on('error', reject);
    }),
    writeDone,
  ]);

  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    // Nettoyer le fichier partiel en cas d'erreur
    await import('node:fs/promises').then((fs) => fs.unlink(tmpPath).catch(() => {}));
    throw new Error(`FFmpeg a échoué (code de sortie ${exitCode}): ${stderr || 'erreur inconnue'}`);
  }

  // Lire le fichier temporaire en Buffer complet
  const { readFile, unlink } = await import('node:fs/promises');
  const audioBuffer = await readFile(tmpPath);

  // Nettoyer le fichier temporaire
  await unlink(tmpPath).catch(() => {});

  if (audioBuffer.length === 0) {
    throw new Error('FFmpeg n\'a produit aucune donnée audio (buffer vide)');
  }

  return audioBuffer;
}

/**
 * Flux lisible retourné par `streamVideoSegment` : un Readable Node accompagné
 * du processus FFmpeg sous-jacent, pour permettre de l'interrompre proprement
 * (ex: déconnexion du client) via `stream.ffmpegProcess.kill()`.
 */
export type FfmpegStream = Readable & { ffmpegProcess: ReturnType<typeof spawn> };

/**
 * Découpe à la volée un segment vidéo et le pipe en direct sous forme de flux lisible
 * (mimetype video/mp4), sans bufferiser l'intégralité en mémoire.
 *
 * Principe "FFmpeg Streamer" :
 *  - `-ss` placé AVANT `-i` → seek rapide (input seeking) ;
 *  - `-c copy` → pas de ré-encodage, on lit stdout au fil de l'eau ;
 *  - `-movflags frag_keyframe+empty_moov` → MP4 fragmenté immédiatement lisible
 *    par un lecteur web en streaming progressif (le moov atom n'a pas besoin d'être
 *    à la fin).
 *
 * @param videoPath - Chemin vers la vidéo source
 * @param start - Début du segment en secondes
 * @param end - Fin du segment en secondes
 * @returns Flux lisible (ffmpeg.stdout) avec le processus attaché pour le cleanup
 */
export function streamVideoSegment(videoPath: string, start: number, end: number): FfmpegStream {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error(`Intervalle de segment invalide : start=${start}, end=${end} (attendu start >= 0 et end > start)`);
  }

  const duration = end - start;

  const ffmpeg = spawn('ffmpeg', [
    '-ss', String(start),
    '-i', videoPath,
    '-t', String(duration),
    '-c', 'copy',
    '-movflags', 'frag_keyframe+empty_moov',
    '-f', 'mp4',
    'pipe:1',
  ]);

  // Propager une impossibilité de démarrer FFmpeg (binaire absent, etc.)
  ffmpeg.on('error', (err) => {
    ffmpeg.stdout?.destroy(err);
  });

  // En cas d'échec d'encodage, détruire le flux avec l'erreur FFmpeg capturée via stderr
  const stderrChunks: Buffer[] = [];
  ffmpeg.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
  ffmpeg.on('close', (code) => {
    if (code !== 0 && ffmpeg.stdout && !ffmpeg.stdout.destroyed) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      ffmpeg.stdout.destroy(
        new Error(`FFmpeg (stream segment) a échoué (code ${code}): ${stderr || 'erreur inconnue'}`)
      );
    }
  });

  const stream = ffmpeg.stdout as FfmpegStream;
  stream.ffmpegProcess = ffmpeg;
  return stream;
}

/**
 * Découpe un segment vidéo ET le recadre au format vertical 9:16 (Shorts / Reels / TikTok).
 *
 * Filtre vidéo `crop` de FFmpeg pour centrer l'action : on conserve une bande de
 * largeur `ih*9/16` au centre de l'image (`x` et `y` par défaut centrés), puis on
 * remet à l'échelle en 1080x1920 et on réencode en H.264 + AAC avec `faststart`
 * (moov atom en tête) pour un fichier web immédiatement diffusable.
 *
 * @param videoPath - Vidéo source
 * @param start - Début en secondes
 * @param end - Fin en secondes
 * @param outputPath - Chemin du fichier vertical final (ex: public/exports/xxx.mp4)
 * @param words - Mots minutés (Deepgram) pour graver des sous-titres dynamiques
 * @returns Le chemin du fichier généré
 */
export async function exportVerticalShort(
  videoPath: string,
  start: number,
  end: number,
  outputPath: string,
  words?: TimedWord[]
): Promise<string> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error(`Intervalle de segment invalide : start=${start}, end=${end} (attendu start >= 0 et end > start)`);
  }

  const { access, mkdir, stat, unlink, writeFile } = await import('node:fs/promises');

  // Tolérance aux pannes : vérifier la source AVANT de lancer FFmpeg
  await access(videoPath);
  await mkdir(join(outputPath, '..'), { recursive: true });

  // Découpage précis à la ms près : on se base sur le 1er et le dernier mot
  // tombant dans la fenêtre [start, end] plutôt que sur les bornes approximatives.
  let clipStart = start;
  let clipEnd = end;
  let assPath: string | undefined;

  const wordsInRange = words?.filter((w) => w.end > start && w.start < end) ?? [];

  if (wordsInRange.length > 0) {
    clipStart = Math.max(start, wordsInRange[0].start);
    clipEnd = Math.min(end, wordsInRange[wordsInRange.length - 1].end);

    // Générer le fichier .ass des sous-titres et le graver via le filtre FFmpeg
    const assContent = generateAssSubtitles(wordsInRange, { karaoke: true });
    assPath = join(tmpdir(), `${randomUUID()}.ass`);
    await writeFile(assPath, assContent, 'utf8');
  }

  // Repli si le cut dérivé des mots est trop court
  if (clipEnd - clipStart < 0.05) {
    clipStart = start;
    clipEnd = end;
  }

  const duration = clipEnd - clipStart;

  // Recadrage vertical centré : bande de largeur ih*9/16 au centre
  const cropFilter = 'crop=ih*9/16:ih';
  let vf = `${cropFilter},scale=1080:1920,setsar=1`;
  if (assPath) {
    vf += `,subtitles=${escapeSubtitlesPath(assPath)}`;
  }

  const ffmpeg = spawn('ffmpeg', [
    '-ss', String(clipStart),
    '-i', videoPath,
    '-t', String(duration),
    '-vf', vf,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'medium',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-f', 'mp4',
    outputPath,
  ]);

  const stderrChunks: Buffer[] = [];
  ffmpeg.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));

  const [exitCode] = await new Promise<[number | null]>((resolve, reject) => {
    ffmpeg.on('close', (code) => resolve([code]));
    ffmpeg.on('error', reject);
  });

  // Nettoyer le fichier .ass temporaire dans tous les cas
  if (assPath) {
    await unlink(assPath).catch(() => {});
  }

  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    await unlink(outputPath).catch(() => {});
    throw new Error(`FFmpeg (export vertical) a échoué (code ${exitCode}): ${stderr || 'erreur inconnue'}`);
  }

  // Vérifier que le fichier a bien été produit et n'est pas vide
  let info;
  try {
    info = await stat(outputPath);
  } catch {
    throw new Error('FFmpeg n\'a pas produit le fichier de sortie');
  }
  if (info.size === 0) {
    await unlink(outputPath).catch(() => {});
    throw new Error('FFmpeg a produit un fichier de sortie vide');
  }

  return outputPath;
}

/**
 * Échappe un chemin de fichier pour le filtre FFmpeg `subtitles=...`
 * (le parseur de filtergraph utilise `:` comme séparateur d'options).
 */
function escapeSubtitlesPath(p: string): string {
  return p
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/ /g, '\\ ');
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