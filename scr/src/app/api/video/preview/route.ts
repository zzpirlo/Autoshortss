import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';

import { streamVideoSegment, FfmpegStream } from '@/lib/videoProcessor';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// FFmpeg + fs nécessitent l'environnement Node (pas edge). Le streaming interdit la mise en cache statique.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '../../../../..');

const dbPath = path.join(projectRoot, 'dev.db');
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

/**
 * GET /api/video/preview?projectId=...&start=...&end=...
 *
 * Découpe le segment [start, end] de la vidéo du projet et le renvoie en flux
 * vidéo (video/mp4) pour le lecteur web. Le flux est produit à la volée par
 * FFmpeg (aucune remise en mémoire), ce qui autorise une lecture immédiate.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get('projectId');
  const start = Number(searchParams.get('start'));
  const end = Number(searchParams.get('end'));

  if (!projectId) {
    return NextResponse.json({ error: 'projectId requis' }, { status: 400 });
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return NextResponse.json({ error: 'start et end doivent être des nombres (secondes)' }, { status: 400 });
  }

  // Résoudre la vidéo source (tolérance aux pannes : erreurs explicites, pas de crash)
  let videoPath: string | undefined;
  try {
    const videoClip = await prisma.videoClip.findFirst({ where: { projectId } });
    videoPath = videoClip?.filePath;
  } catch (dbError) {
    console.error('[Preview] Erreur DB:', dbError);
    return NextResponse.json({ error: 'Erreur base de données' }, { status: 500 });
  }

  if (!videoPath) {
    return NextResponse.json({ error: 'Projet ou vidéo source introuvable' }, { status: 404 });
  }

  try {
    await access(videoPath);
  } catch {
    return NextResponse.json(
      { error: 'Fichier vidéo source introuvable sur le disque (upload peut avoir été nettoyé)' },
      { status: 404 }
    );
  }

  let stream: FfmpegStream;
  try {
    stream = streamVideoSegment(videoPath, start, end);
  } catch (segError) {
    return NextResponse.json(
      { error: segError instanceof Error ? segError.message : 'Échec de la découpe' },
      { status: 400 }
    );
  }

  // Interrompre FFmpeg proprement si le client se déconnecte (évite les processus zombis)
  const ffmpeg = stream.ffmpegProcess;
  request.signal.addEventListener('abort', () => {
    ffmpeg.kill('SIGKILL');
  });

  // Le corps d'une Response Web doit être un ReadableStream, pas un Readable Node
  const webStream = Readable.toWeb(stream);

  return new Response(webStream as unknown as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'none',
    },
  });
}
