/**
 * Types partagés pour le pipeline IA
 */

/**
 * Mode stratégique de découpe des clips.
 * - punchy   : hooks/punchlines fulgurants (15-30s)
 * - standard : comportement par défaut (30-60s)
 * - deep     : segments longs (60-90s+) pour rétention & monétisation TikTok
 */
export type ClipDurationMode = 'punchy' | 'standard' | 'deep';

export const CLIP_DURATION_MODES: ClipDurationMode[] = ['punchy', 'standard', 'deep'];

export const DEFAULT_CLIP_DURATION_MODE: ClipDurationMode = 'standard';

/**
 * Normalise une valeur inconnue (body/formData/DB) en ClipDurationMode valide.
 */
export function normalizeClipDurationMode(raw: unknown): ClipDurationMode {
  return CLIP_DURATION_MODES.includes(raw as ClipDurationMode)
    ? (raw as ClipDurationMode)
    : DEFAULT_CLIP_DURATION_MODE;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence: number;
  speaker?: number;
}

export interface TranscriptResult {
  fullText: string;
  segments: TranscriptSegment[];
  language: string;
  duration: number;
}

export interface ViralMoment {
  rank: number;
  title: string;
  viralScore: number;
  hook: string;
  startTime: number;
  endTime: number;
  reasoning: string;
}

export interface DeepSeekResponse {
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface VideoMetadata {
  width: number;
  height: number;
  fps: number;
  duration: number;
}

export interface UploadResult {
  projectId: string;
  videoClipId: string;
  transcriptId?: string;
  viralMoments?: ViralMoment[];
  errors: string[];
  success: boolean;
}