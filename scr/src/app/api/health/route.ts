import { NextResponse } from 'next/server';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

// Create the database connection using better-sqlite3
const dbPath = path.join(__dirname, '../../../../../dev.db');
const sqlite = new Database(dbPath);
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

async function checkFFmpeg(): Promise<{ available: boolean; version?: string; error?: string }> {
  try {
    const { stdout } = await execAsync('ffmpeg -version');
    const versionMatch = stdout.match(/ffmpeg version ([\d.]+)/);
    return { available: true, version: versionMatch?.[1] };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function checkDatabase(): Promise<{ available: boolean; error?: string }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { available: true };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    await prisma.$disconnect();
  }
}

export async function GET(): Promise<NextResponse> {
  const [ffmpeg, database] = await Promise.all([checkFFmpeg(), checkDatabase()]);

  const healthy = ffmpeg.available && database.available;

  return NextResponse.json(
    {
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        ffmpeg,
        database,
      },
    },
    { status: healthy ? 200 : 503 }
  );
}