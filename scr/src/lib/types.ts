/**
 * Types partagés pour le pipeline IA
 */

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