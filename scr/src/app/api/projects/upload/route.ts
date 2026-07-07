import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile, unlink, mkdir, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractAudioToMp3, getVideoDuration, getVideoMetadata } from '@/lib/videoProcessor';
import { transcribeAudioStream, TranscriptSegment } from '@/lib/transcriptService';
import { analyzeViralMoments } from '@/lib/aiAnalyzer';
import { ViralMoment } from '@/lib/types';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '../../../../..');

// Create the database connection using better-sqlite3
const dbPath = path.join(projectRoot, 'dev.db');
const sqlite = new Database(dbPath);
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

// Configuration des clés API depuis les variables d'environnement
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

if (!DEEPGRAM_API_KEY) {
  throw new Error('DEEPGRAM_API_KEY manquant dans les variables d\'environnement');
}
if (!DEEPSEEK_API_KEY) {
  throw new Error('DEEPSEEK_API_KEY manquant dans les variables d\'environnement');
}


interface UploadResponse {
  success: boolean;
  projectId?: string;
  videoClipId?: string;
  transcriptId?: string;
  viralMoments?: ViralMoment[];
  errors: string[];
  message?: string;
}

/**
 * Nettoie un nom de fichier pour éviter tout caractère problématique dans les
 * commandes FFmpeg (traits verticaux '｜', apostrophes, accents, espaces, etc.).
 *  - Supprime les accents (normalisation NFD + suppression des diacritiques)
 *  - Remplace tout caractère non alphanumérique par un tiret simple `-`
 *  - Met en minuscules, réduit les tirets consécutifs et nettoie les bords
 */
function sanitizeFileName(raw: string): string {
  const withoutAccents = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return withoutAccents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Sauvegarde la vidéo uploadée dans un fichier temporaire.
 * Écrit le fichier par streaming (mémoire constante) pour autoriser les gros
 * fichiers vidéo sans les bufferiser intégralement en RAM.
 */
async function saveUploadedVideo(file: File): Promise<string> {
  const tempDir = join(tmpdir(), 'autoshorts-uploads');
  await mkdir(tempDir, { recursive: true });

  const ext = path.extname(file.name).toLowerCase() || '.mp4';
  const base = sanitizeFileName(path.parse(file.name).name) || 'video';
  const fileName = `${uuidv4()}-${base}${ext}`;
  const filePath = join(tempDir, fileName);

  // Streaming direct du corps de la requête vers le disque
  const ws = createWriteStream(filePath);
  await pipeline(Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]), ws);

  return filePath;
}

/**
 * Déplace la vidéo temporaire vers un emplacement persistant
 * `data/uploads/<projectId>-<nomSécurisé><ext>` afin qu'elle reste disponible
 * pour la prévisualisation et l'export. Le nom est sanitizé pour ne jamais
 * transmettre de caractères spéciaux à FFmpeg.
 */
async function persistUploadedVideo(
  tempPath: string,
  projectId: string,
  baseName: string,
  ext: string,
): Promise<string> {
  const destDir = join(projectRoot, 'data', 'uploads');
  await mkdir(destDir, { recursive: true });
  const safeBase = sanitizeFileName(baseName) || 'video';
  const destPath = join(destDir, `${projectId}-${safeBase}${ext}`);

  try {
    await rename(tempPath, destPath);
  } catch {
    // Fallback si le renommage est inter-disques (copie + suppression)
    const { copyFile, unlink: rm } = await import('node:fs/promises');
    await copyFile(tempPath, destPath);
    await rm(tempPath).catch(() => {});
  }
  return destPath;
}

/**
 * Nettoie le fichier temporaire
 */
async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // Ignorer les erreurs de nettoyage
  }
}

/**
 * API POST /api/projects/upload
 * Pipeline complet : Upload → Extraction audio → Transcription Deepgram → Analyse DeepSeek
 * Avec tolérance aux pannes : si DeepSeek échoue, on garde quand même la transcription
 */
export async function POST(request: NextRequest): Promise<NextResponse<UploadResponse>> {
  // DEBUG : permet de voir la requête arriver dans le terminal du serveur
  console.log('--> API Upload appelée');

  const errors: string[] = [];
  let tempVideoPath: string | null = null;

  try {
    // 1. Récupérer le fichier et les métadonnées du formulaire
    const formData = await request.formData();
    const file = formData.get('video') as File | null;
    const projectName = formData.get('projectName') as string | null;
    const projectDescription = formData.get('projectDescription') as string | null;

    if (!file) {
      return NextResponse.json(
        { success: false, errors: ['Aucun fichier vidéo fourni'] },
        { status: 400 }
      );
    }

    // Sécurité absolue : s'assurer que le dossier de stockage persistant existe
    await mkdir(join(projectRoot, 'data', 'uploads'), { recursive: true });

    // Valider le type de fichier
    const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { success: false, errors: ['Format de fichier non supporté. Utilisez MP4, WebM, MOV, AVI ou MKV'] },
        { status: 400 }
      );
    }

    // 2. Sauvegarder le fichier temporairement
    tempVideoPath = await saveUploadedVideo(file);

    // 3. Obtenir les métadonnées vidéo
    const { width, height, fps } = await getVideoMetadata(tempVideoPath);
    const duration = await getVideoDuration(tempVideoPath);

    // 4. Créer le projet en base
    const project = await prisma.project.create({
      data: {
        name: projectName || file.name.replace(/\.[^/.]+$/, ''),
        description: projectDescription || '',
      },
    });

    // 4b. Persister la vidéo source de façon permanente (pour preview/export)
    const ext = path.extname(file.name).toLowerCase() || '.mp4';
    const baseName = sanitizeFileName(path.parse(file.name).name);
    const persistedPath = await persistUploadedVideo(tempVideoPath!, project.id, baseName, ext);
    tempVideoPath = null; // le fichier a été déplacé ; ne plus le supprimer
    const sourcePath = persistedPath; // chemin valide pour le traitement (audio/export)

    // 5. Créer l'entrée VideoClip
    const videoClip = await prisma.videoClip.create({
      data: {
        projectId: project.id,
        filePath: persistedPath, // chemin persistant vers la vidéo source
        duration,
        width,
        height,
        fps,
        fileSize: file.size,
      },
    });

    let transcriptId: string | undefined;
    let viralMoments: ViralMoment[] | undefined;

    // 6. EXTRACTION AUDIO + TRANSCRIPTION DEEPGRAM
    let transcriptResult: Awaited<ReturnType<typeof transcribeAudioStream>> | null = null;

    try {
      const audioBuffer = await extractAudioToMp3(sourcePath);
      transcriptResult = await transcribeAudioStream(audioBuffer, DEEPGRAM_API_KEY!, {
        language: 'fr',
        diarize: true,
        smartFormat: true,
        punctuate: true,
        utterances: true,
      });

      // 7. Sauvegarder la transcription en base (même si DeepSeek échoue après)
      const transcript = await prisma.transcript.create({
        data: {
          projectId: project.id,
          content: transcriptResult.fullText,
          language: transcriptResult.language,
        },
      });

      transcriptId = transcript.id;

      // Persister les mots minutés (Deepgram) pour la génération de sous-titres
      // dynamiques à l'export. Tolérance aux pannes : ne fait pas échouer l'upload.
      if (transcriptResult.words.length) {
        try {
          const transcriptsDir = join(projectRoot, 'data', 'transcripts');
          await mkdir(transcriptsDir, { recursive: true });
          await writeFile(
            join(transcriptsDir, `${project.id}.json`),
            JSON.stringify(transcriptResult.words),
            'utf8',
          );
        } catch (wordsErr) {
          console.error('[Upload] Échec sauvegarde mots sous-titres:', wordsErr);
        }
      }

    } catch (transcriptionError) {
      const errorMsg = `Erreur transcription Deepgram: ${transcriptionError instanceof Error ? transcriptionError.message : 'Erreur inconnue'}`;
      errors.push(errorMsg);
      console.error('[Upload] Erreur transcription:', transcriptionError);
    }

    // 8. ANALYSE DEEPSEEK (tolérance aux pannes : on continue même si ça échoue)
    if (transcriptResult) {
      try {
        viralMoments = await analyzeViralMoments(
          transcriptResult.fullText,
          transcriptResult.segments.map(s => ({
            start: s.start,
            end: s.end,
            text: s.text,
            confidence: s.confidence,
          })),
          DEEPSEEK_API_KEY!
        );

        // Mettre à jour le projet avec les moments viraux (optionnel : créer une table dédiée)
        await prisma.project.update({
          where: { id: project.id },
          data: {
            description: (projectDescription || '') + '\n\n--- Moments viraux ---\n' +
              viralMoments.map(m =>
                `#${m.rank} ${m.title} (Score: ${m.viralScore}/100)\n` +
                `Hook: "${m.hook}"\n` +
                `Temps: ${m.startTime}s - ${m.endTime}s\n` +
                `Raison: ${m.reasoning}`
              ).join('\n\n'),
          },
        });

      } catch (aiError) {
        const errorMsg = `Erreur analyse DeepSeek: ${aiError instanceof Error ? aiError.message : 'Erreur inconnue'}`;
        errors.push(errorMsg);
        console.error('[Upload] Erreur analyse IA:', aiError);
        // On ne fait pas échouer la requête : la transcription est déjà sauvée
      }
    }

    // 9. Nettoyer le fichier temporaire (la source est désormais persistée, donc rien à supprimer ici)
    if (tempVideoPath) {
      await cleanupTempFile(tempVideoPath);
      tempVideoPath = null;
    }

    // 10. Réponse
    const hasErrors = errors.length > 0;
    const success = transcriptResult !== null; // Succès si au moins la transcription a marché

    return NextResponse.json({
      success,
      projectId: project.id,
      videoClipId: videoClip.id,
      transcriptId,
      viralMoments,
      errors,
      message: success
        ? (hasErrors ? 'Upload traité avec quelques erreurs (voir errors)' : 'Upload et traitement complets réussis')
        : 'Échec du traitement',
    }, { status: success ? 200 : 500 });

  } catch (error) {
    console.error('[Upload] Erreur critique:', error);

    // Nettoyage en cas d'erreur critique
    if (tempVideoPath) {
      await cleanupTempFile(tempVideoPath);
    }

    return NextResponse.json(
      {
        success: false,
        errors: [`Erreur serveur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`]
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/projects/upload - Liste les projets (pour debug)
 */
export async function GET(): Promise<NextResponse> {
  try {
    const projects = await prisma.project.findMany({
      include: {
        videoClips: true,
        transcripts: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { error: 'Erreur récupération projets' },
      { status: 500 }
    );
  }
}