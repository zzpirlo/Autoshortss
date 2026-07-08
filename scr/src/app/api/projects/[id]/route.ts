import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';

// Connexion SQLite (même configuration que les autres routes API)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '../../../../..');
const dbPath = path.join(projectRoot, 'dev.db');
const sqlite = new Database(dbPath);
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

// better-sqlite3 est natif : on force le runtime Node.js (pas Edge)
export const runtime = 'nodejs';

/**
 * GET /api/projects/[id]
 * Renvoie l'état de traitement d'un projet pour le polling du front-end :
 * status (PENDING/PROCESSING/COMPLETED/FAILED), stage, error, viralMoments…
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: { videoClips: true, transcripts: true },
  });

  if (!project) {
    return NextResponse.json({ error: 'Projet introuvable' }, { status: 404 });
  }

  const clip = project.videoClips[0];

  return NextResponse.json({
    id: project.id,
    name: project.name,
    status: project.status,
    stage: project.stage,
    error: project.error,
    viralMoments: project.viralMoments,
    description: project.description,
    videoClip: clip
      ? {
          id: clip.id,
          duration: clip.duration,
          width: clip.width,
          height: clip.height,
          fps: clip.fps,
          filePath: clip.filePath,
        }
      : null,
    transcriptId: project.transcripts[0]?.id ?? null,
  });
}
