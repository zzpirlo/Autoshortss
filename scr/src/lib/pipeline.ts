import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

import { extractAudioToMp3, getVideoDuration, getVideoMetadata } from '@/lib/videoProcessor';
import { transcribeAudioStream } from '@/lib/transcriptService';
import { analyzeViralMoments } from '@/lib/aiAnalyzer';
import { PrismaClient, Prisma } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';

// Connexion SQLite (même configuration que les routes API)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '../..'); // src/lib -> scr

const dbPath = path.join(projectRoot, 'dev.db');
const sqlite = new Database(dbPath);
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

if (!DEEPGRAM_API_KEY) {
  throw new Error('DEEPGRAM_API_KEY manquant dans les variables d\'environnement');
}
if (!DEEPSEEK_API_KEY) {
  throw new Error('DEEPSEEK_API_KEY manquant dans les variables d\'environnement');
}

/**
 * Retire la section "--- Moments viraux ---" d'une description pour éviter
 * de la dupliquer lors d'une reprise (processProject la ré-ajoute).
 */
function stripMoments(description?: string | null): string {
  if (!description) return '';
  const idx = description.indexOf('\n\n--- Moments viraux ---');
  return idx === -1 ? description : description.slice(0, idx);
}

/**
 * TRAITEMENT LOURD (fire-and-forget). Exécuté après la réponse HTTP 200 de
 * l'upload, ou relancé au démarrage pour les projets orphelins.
 * PENDING → PROCESSING → COMPLETED | FAILED.
 */
export async function processProject(
  projectId: string,
  sourcePath: string,
  fileSize: number,
  projectDescription: string,
): Promise<void> {
  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'PROCESSING', stage: 'AUDIO' },
    });

    const { width, height, fps } = await getVideoMetadata(sourcePath);
    const duration = await getVideoDuration(sourcePath);

    await prisma.videoClip.create({
      data: { projectId, filePath: sourcePath, duration, width, height, fps, fileSize },
    });

    const audioBuffer = await extractAudioToMp3(sourcePath);
    await prisma.project.update({ where: { id: projectId }, data: { stage: 'TRANSCRIPT' } });

    const transcriptResult = await transcribeAudioStream(audioBuffer, DEEPGRAM_API_KEY!, {
      language: 'fr',
      diarize: true,
      smartFormat: true,
      punctuate: true,
      utterances: true,
    });

    await prisma.transcript.create({
      data: {
        projectId,
        content: transcriptResult.fullText,
        language: transcriptResult.language,
      },
    });

    if (transcriptResult.words.length) {
      try {
        const transcriptsDir = path.join(projectRoot, 'data', 'transcripts');
        await mkdir(transcriptsDir, { recursive: true });
        await writeFile(
          path.join(transcriptsDir, `${projectId}.json`),
          JSON.stringify(transcriptResult.words),
          'utf8',
        );
      } catch (wordsErr) {
        console.error('[Pipeline] Échec sauvegarde mots sous-titres:', wordsErr);
      }
    }

    await prisma.project.update({ where: { id: projectId }, data: { stage: 'ANALYSIS' } });
    const viralMoments = await analyzeViralMoments(
      transcriptResult.fullText,
      transcriptResult.segments.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        confidence: s.confidence,
      })),
      DEEPSEEK_API_KEY!,
    );

    const description =
      (projectDescription || '') +
      '\n\n--- Moments viraux ---\n' +
      viralMoments
        .map(
          (m) =>
            `#${m.rank} ${m.title} (Score: ${m.viralScore}/100)\n` +
            `Hook: "${m.hook}"\n` +
            `Temps: ${m.startTime}s - ${m.endTime}s\n` +
            `Raison: ${m.reasoning}`,
        )
        .join('\n\n');

    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'COMPLETED', stage: null, description, viralMoments: viralMoments as unknown as Prisma.InputJsonValue },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[Pipeline] Erreur traitement projet', projectId, ':', err);
    await prisma.project
      .update({ where: { id: projectId }, data: { status: 'FAILED', stage: null, error: msg } })
      .catch(() => {});
  }
}

/**
 * REPRISE AUTOMATIQUE des projets orphelins au démarrage du serveur.
 * Relance le traitement de tout projet encore PENDING ou PROCESSING
 * (le serveur ayant été redémarré en cours de traitement).
 */
export async function recoverOrphanProjects(): Promise<void> {
  // Garde anti-double-exécution (HMR / register appelé plusieurs fois)
  if ((recoverOrphanProjects as unknown as { _done?: boolean })._done) return;
  (recoverOrphanProjects as unknown as { _done?: boolean })._done = true;

  const orphans = await prisma.project.findMany({
    where: { status: { in: ['PENDING', 'PROCESSING'] } },
    include: { videoClips: true },
  });

  if (orphans.length === 0) {
    console.log('[Init] Aucun projet orphelin à reprendre.');
    return;
  }

  console.log(
    `[Init] ${orphans.length} projet(s) orphelin(s) détecté(s) (PENDING/PROCESSING), relance du traitement…`,
  );

  for (const p of orphans) {
    const clip = p.videoClips[0];
    if (!clip || !clip.filePath) {
      console.log(`[Init] Projet orphelin ${p.id} : aucun fichier vidéo associé, marqué FAILED.`);
      await prisma.project
        .update({
          where: { id: p.id },
          data: { status: 'FAILED', stage: null, error: 'Fichier vidéo introuvable lors de la reprise' },
        })
        .catch(() => {});
      continue;
    }

    console.log(`[Init] Projet orphelin détecté : ${p.id}, statut=${p.status}, relance du traitement...`);

    // Nettoyage des enfants partiels pour éviter les doublons (videoClip, transcript, mots)
    await prisma.transcript.deleteMany({ where: { projectId: p.id } }).catch(() => {});
    await prisma.videoClip.deleteMany({ where: { projectId: p.id } }).catch(() => {});
    await import('node:fs/promises').then((fs) =>
      fs.unlink(path.join(projectRoot, 'data', 'transcripts', `${p.id}.json`)).catch(() => {}),
    );

    const description = stripMoments(p.description);
    void processProject(p.id, clip.filePath, clip.fileSize ?? 0, description).catch((e) =>
      console.error(`[Init] Échec de la reprise du projet ${p.id}:`, e),
    );
  }
}
