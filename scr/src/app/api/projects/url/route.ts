import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ytdl from '@distube/ytdl-core';

import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';
import { processProject } from '@/lib/pipeline';
import { ClipDurationMode, normalizeClipDurationMode } from '@/lib/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '../../../../..');

// Connexion SQLite (même configuration que les autres routes API)
const dbPath = path.join(projectRoot, 'dev.db');
const sqlite = new Database(dbPath);
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

// better-sqlite3 est natif : on force le runtime Node.js (pas Edge)
export const runtime = 'nodejs';

// Sécurité serveur : durée maximale autorisée pour une vidéo YouTube (20 min)
const MAX_DURATION_SECONDS = 20 * 60;

interface UrlImportResponse {
  success: boolean;
  projectId?: string;
  status?: string;
  message?: string;
  errors: string[];
}

interface UrlRequestBody {
  url?: unknown;
  clipDurationMode?: unknown;
}

/**
 * Télécharge la vidéo YouTube en streaming vers `data/uploads/<projectId>.mp4`
 * (aucun chargement en RAM — [FFmpeg Streamer]), puis déclenche le pipeline
 * lourd existant (FFmpeg → Deepgram → DeepSeek).
 *
 * Fonction fire-and-forget : toute erreur bascule le projet en FAILED sans
 * faire planter le serveur ([Fault Tolerance]).
 */
async function downloadAndProcess(
  projectId: string,
  url: string,
  destPath: string,
  clipDurationMode: ClipDurationMode,
): Promise<void> {
  try {
    // Stream YouTube → fichier disque (format combiné audio+vidéo, une seule passe)
    const videoStream = ytdl(url, { filter: 'audioandvideo', quality: 'highest' });
    const ws = createWriteStream(destPath);
    await pipeline(videoStream, ws);

    // Taille réelle du fichier téléchargé (métadonnée du videoClip)
    let fileSize = 0;
    try {
      fileSize = (await stat(destPath)).size;
    } catch {
      // taille non critique : on continue avec 0
    }

    // Déclenche le pipeline existant, sans rien changer à sa logique
    await processProject(projectId, destPath, fileSize, '', clipDurationMode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[URL Import] Échec du téléchargement/traitement', projectId, ':', err);
    await unlink(destPath).catch(() => {});
    await prisma.project
      .update({ where: { id: projectId }, data: { status: 'FAILED', stage: null, error: msg } })
      .catch(() => {});
  }
}

/**
 * API POST /api/projects/url
 * Import Premium par URL YouTube. Valide l'URL et la durée (< 20 min), crée le
 * projet (PENDING), répond immédiatement 200, puis télécharge et traite la
 * vidéo en arrière-plan (même modèle asynchrone que l'upload de fichier).
 */
export async function POST(request: NextRequest): Promise<NextResponse<UrlImportResponse>> {
  console.log('--> API Import URL appelée');

  try {
    const body = (await request.json().catch(() => ({}))) as UrlRequestBody;
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const clipDurationMode = normalizeClipDurationMode(body.clipDurationMode);

    if (!url) {
      return NextResponse.json(
        { success: false, errors: ['Aucune URL fournie'] },
        { status: 400 },
      );
    }

    if (!ytdl.validateURL(url)) {
      return NextResponse.json(
        { success: false, errors: ['URL YouTube invalide'] },
        { status: 400 },
      );
    }

    // Récupère les métadonnées (titre + durée) pour valider avant tout téléchargement
    const info = await ytdl.getInfo(url);
    const durationSeconds = Number(info.videoDetails.lengthSeconds) || 0;
    const title = info.videoDetails.title?.trim() || 'Vidéo YouTube';

    if (durationSeconds <= 0) {
      return NextResponse.json(
        { success: false, errors: ['Impossible de déterminer la durée de la vidéo'] },
        { status: 400 },
      );
    }

    if (durationSeconds > MAX_DURATION_SECONDS) {
      return NextResponse.json(
        {
          success: false,
          errors: [`Vidéo trop longue (max 20 min, durée détectée : ${Math.round(durationSeconds / 60)} min)`],
        },
        { status: 400 },
      );
    }

    // Prépare le dossier de destination
    await mkdir(join(projectRoot, 'data', 'uploads'), { recursive: true });

    // Crée le projet en base (PENDING)
    const project = await prisma.project.create({
      data: {
        name: title,
        description: '',
        status: 'PENDING',
        clipDurationMode,
      },
    });

    const destPath = join(projectRoot, 'data', 'uploads', `${project.id}.mp4`);

    // Réponse immédiate — téléchargement + traitement en arrière-plan
    const response = NextResponse.json(
      {
        success: true,
        projectId: project.id,
        status: project.status,
        message: 'Projet créé, téléchargement et traitement en cours',
        errors: [],
      },
      { status: 200 },
    );

    void downloadAndProcess(project.id, url, destPath, clipDurationMode).catch((e) =>
      console.error('[URL Import] downloadAndProcess non capturé:', e),
    );

    return response;
  } catch (error) {
    console.error('[URL Import] Erreur critique:', error);
    return NextResponse.json(
      {
        success: false,
        errors: [`Erreur serveur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`],
      },
      { status: 500 },
    );
  }
}
