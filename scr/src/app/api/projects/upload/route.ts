import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractAudioToMp3Stream, getVideoDuration, getVideoMetadata } from '@/lib/videoProcessor';
import { transcribeAudioStream, TranscriptSegment } from '@/lib/transcriptService';
import { analyzeViralMoments } from '@/lib/aiAnalyzer';
import { ViralMoment } from '@/lib/types';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create the database connection using better-sqlite3
const dbPath = path.join(__dirname, '../../../../../dev.db');
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
 * Sauvegarde la vidéo uploadée dans un fichier temporaire
 */
async function saveUploadedVideo(file: File): Promise<string> {
  const tempDir = join(tmpdir(), 'autoshorts-uploads');
  await mkdir(tempDir, { recursive: true });

  const fileName = `${uuidv4()}-${file.name}`;
  const filePath = join(tempDir, fileName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  return filePath;
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
    const { duration: videoDuration, width, height, fps } = await getVideoMetadata(tempVideoPath);
    const duration = videoDuration || await getVideoDuration(tempVideoPath);

    // 4. Créer le projet en base
    const project = await prisma.project.create({
      data: {
        name: projectName || file.name.replace(/\.[^/.]+$/, ''),
        description: projectDescription || '',
      },
    });

    // 5. Créer l'entrée VideoClip
    const videoClip = await prisma.videoClip.create({
      data: {
        projectId: project.id,
        filePath: tempVideoPath, // On garde le chemin pour référence (le fichier sera nettoyé après)
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
      const audioStream = await extractAudioToMp3Stream(tempVideoPath);
      transcriptResult = await transcribeAudioStream(audioStream, DEEPGRAM_API_KEY!, {
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

    // 9. Nettoyer le fichier temporaire (optionnel : on pourrait le déplacer vers un stockage permanent)
    await cleanupTempFile(tempVideoPath);
    tempVideoPath = null;

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