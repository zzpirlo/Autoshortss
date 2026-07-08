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

import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';
import { processProject } from '@/lib/pipeline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '../../../../..');

// Create the database connection using better-sqlite3
const dbPath = path.join(projectRoot, 'dev.db');
const sqlite = new Database(dbPath);
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

// better-sqlite3 est natif : on force le runtime Node.js (pas Edge)
export const runtime = 'nodejs';

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
  status?: string;
  message?: string;
  errors: string[];
}

/**
 * Nettoie un nom de fichier pour éviter tout caractère problématique dans les
 * commandes FFmpeg.
 */
function sanitizeFileName(raw: string): string {
  const withoutAccents = raw.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return withoutAccents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Sauvegarde la vidéo uploadée dans un fichier temporaire (streaming).
 */
async function saveUploadedVideo(file: File): Promise<string> {
  const tempDir = join(tmpdir(), 'autoshorts-uploads');
  await mkdir(tempDir, { recursive: true });

  const ext = path.extname(file.name).toLowerCase() || '.mp4';
  const base = sanitizeFileName(path.parse(file.name).name) || 'video';
  const fileName = `${uuidv4()}-${base}${ext}`;
  const filePath = join(tempDir, fileName);

  const ws = createWriteStream(filePath);
  await pipeline(Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]), ws);

  return filePath;
}

/**
 * Déplace la vidéo temporaire vers `data/uploads/<projectId>-<nomSécurisé><ext>`.
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
    const { copyFile, unlink: rm } = await import('node:fs/promises');
    await copyFile(tempPath, destPath);
    await rm(tempPath).catch(() => {});
  }
  return destPath;
}

async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // Ignorer les erreurs de nettoyage
  }
}

/**
 * API POST /api/projects/upload
 * Pipeline asynchrone : écriture du fichier + création du projet (PENDING) →
 * réponse 200 immédiate, puis traitement lourd en arrière-plan (voir
 * src/lib/pipeline.ts, également relancé au démarrage pour les orphelins).
 */
export async function POST(request: NextRequest): Promise<NextResponse<UploadResponse>> {
  console.log('--> API Upload appelée');

  const errors: string[] = [];
  let tempVideoPath: string | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get('video') as File | null;
    const projectName = formData.get('projectName') as string | null;
    const projectDescription = (formData.get('projectDescription') as string | null) || '';

    if (!file) {
      return NextResponse.json(
        { success: false, errors: ['Aucun fichier vidéo fourni'] },
        { status: 400 },
      );
    }

    await mkdir(join(projectRoot, 'data', 'uploads'), { recursive: true });

    const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { success: false, errors: ['Format de fichier non supporté. Utilisez MP4, WebM, MOV, AVI ou MKV'] },
        { status: 400 },
      );
    }

    // 1. Sauvegarder le fichier temporairement (streaming)
    tempVideoPath = await saveUploadedVideo(file);
    const ext = path.extname(file.name).toLowerCase() || '.mp4';
    const baseName = sanitizeFileName(path.parse(file.name).name);

    // 2. Créer le projet en base (PENDING)
    const project = await prisma.project.create({
      data: {
        name: projectName || file.name.replace(/\.[^/.]+$/, ''),
        description: projectDescription,
        status: 'PENDING',
      },
    });

    // 3. Persister la vidéo source (rollback du projet si échec)
    let persistedPath: string;
    try {
      persistedPath = await persistUploadedVideo(tempVideoPath!, project.id, baseName, ext);
    } catch (persistErr) {
      await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
      throw persistErr;
    }
    tempVideoPath = null; // fichier déplacé, plus rien à nettoyer

    // 4. Réponse immédiate — le traitement lourd continue en arrière-plan
    const response = NextResponse.json(
      {
        success: true,
        projectId: project.id,
        status: project.status,
        message: 'Projet créé, traitement en cours',
        errors: [],
      },
      { status: 200 },
    );

    // Déclenchement asynchrone (non bloquant).
    void processProject(project.id, persistedPath, file.size, projectDescription).catch((e) =>
      console.error('[Upload] processProject non capturé:', e),
    );

    return response;
  } catch (error) {
    console.error('[Upload] Erreur critique:', error);
    if (tempVideoPath) {
      await cleanupTempFile(tempVideoPath);
    }
    return NextResponse.json(
      {
        success: false,
        errors: [`Erreur serveur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`],
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/projects/upload - Liste les projets (debug / dashboard)
 */
export async function GET(): Promise<NextResponse> {
  try {
    const projects = await prisma.project.findMany({
      include: { videoClips: true, transcripts: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json({ error: 'Erreur récupération projets' }, { status: 500 });
  }
}
