import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { exportVerticalShort } from '@/lib/videoProcessor';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '../../../../..');

const dbPath = path.join(projectRoot, 'dev.db');
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

interface ExportResponse {
  success: boolean;
  url?: string;
  filePath?: string;
  projectId?: string;
  start?: number;
  end?: number;
  error?: string;
}

/**
 * POST /api/video/export
 * Corps JSON : { projectId, start, end }
 *
 * Découpe le segment [start, end] de la vidéo du projet, le recadre au format
 * vertical 9:16 et sauvegarde le fichier final dans `public/exports/`.
 * Tolérance aux pannes : chaque étape (paramètres, DB, fichier source, FFmpeg)
 * renvoie une erreur explicite plutôt que de planter.
 */
export async function POST(request: NextRequest): Promise<NextResponse<ExportResponse>> {
  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Corps JSON invalide' }, { status: 400 });
  }

  const projectId = body?.projectId as string | undefined;
  const start = Number(body?.start);
  const end = Number(body?.end);

  if (!projectId || !Number.isFinite(start) || !Number.isFinite(end)) {
    return NextResponse.json(
      { success: false, error: 'projectId (string), start et end (nombres, secondes) requis' },
      { status: 400 }
    );
  }

  // Résoudre la vidéo source
  let videoPath: string | undefined;
  try {
    const videoClip = await prisma.videoClip.findFirst({ where: { projectId } });
    videoPath = videoClip?.filePath;
  } catch (dbError) {
    console.error('[Export] Erreur DB:', dbError);
    return NextResponse.json({ success: false, error: 'Erreur base de données' }, { status: 500 });
  }

  if (!videoPath) {
    return NextResponse.json({ success: false, error: 'Projet ou vidéo source introuvable' }, { status: 404 });
  }

  try {
    await access(videoPath);
  } catch {
    return NextResponse.json(
      { success: false, error: 'Fichier vidéo source introuvable sur le disque (upload peut avoir été nettoyé)' },
      { status: 404 }
    );
  }

  // Dossier de sortie public/exports (servi statiquement par Next.js)
  const exportsDir = path.join(projectRoot, 'public', 'exports');
  const fileName = `${projectId}-${randomUUID()}.mp4`;
  const outputPath = path.join(exportsDir, fileName);

  try {
    await exportVerticalShort(videoPath, start, end, outputPath);
  } catch (exportError) {
    console.error('[Export] Échec FFmpeg:', exportError);
    return NextResponse.json(
      { success: false, error: exportError instanceof Error ? exportError.message : 'Échec de l\'export' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    url: `/exports/${fileName}`,
    filePath: outputPath,
    projectId,
    start,
    end,
  });
}
