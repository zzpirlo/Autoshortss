import { DeepgramClient } from '@deepgram/sdk';
import { Readable } from 'node:stream';

/**
 * Service de transcription via Deepgram API
 * Utilise le streaming pour éviter de charger tout l'audio en mémoire
 */

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence: number;
  speaker?: number;
}

/**
 * Mot individuel avec son timestamp précis (secondes) reçu de Deepgram.
 * Conservé pour la génération de sous-titres dynamiques (style CapCut).
 */
export interface TranscriptWord {
  start: number;
  end: number;
  text: string;
  confidence: number;
  speaker?: number;
}

export interface TranscriptResult {
  fullText: string;
  segments: TranscriptSegment[];
  /** Mots individuels minutés (Deepgram) — base des sous-titres dynamiques */
  words: TranscriptWord[];
  language: string;
  duration: number;
}

/**
 * Transcrit un flux audio MP3 via Deepgram
 * @param audioStream - Stream audio MP3 (16kHz mono) OU un Buffer MP3 complet
 * @param apiKey - Clé API Deepgram
 * @param options - Options de transcription
 */
export async function transcribeAudioStream(
  audioStream: Readable | Buffer,
  apiKey: string,
  options: {
    language?: string;
    diarize?: boolean;
    smartFormat?: boolean;
    punctuate?: boolean;
    utterances?: boolean;
  } = {}
): Promise<TranscriptResult> {
  const deepgram = new DeepgramClient({ apiKey });

  const {
    language = 'fr',
    diarize = true,
    smartFormat = true,
    punctuate = true,
    utterances = true
  } = options;

  // Convertir l'entrée en buffer complet pour l'upload
  let audioBuffer: Buffer;
  if (Buffer.isBuffer(audioStream)) {
    audioBuffer = audioStream;
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    audioBuffer = Buffer.concat(chunks);
  }

  if (audioBuffer.length === 0) {
    throw new Error('Le buffer audio est vide — impossible de transcrire');
  }

  // Transcrire via le SDK Deepgram v5 (listen.v1.media.transcribeFile).
  // IMPORTANT : on encapsule le buffer dans un objet WithMetadata avec un
  // `contentType` explicite ('audio/mpeg'). Un Buffer nu est envoyé avec un
  // Content-Type 'application/octet-stream', ce qui fait renvoyer à Deepgram
  // une erreur 400 "failed to process audio: corrupt or unsupported data".
  const response = await deepgram.listen.v1.media.transcribeFile(
    { data: audioBuffer, contentType: 'audio/mpeg' },
    {
      model: 'nova-2',
      language,
      diarize,
      smart_format: smartFormat,
      punctuate,
      utterances,
      // Options pour la détection de locuteurs
      multichannel: false,
    }
  );

  // La réponse est une union ; on attend la réponse synchrone standard
  if (!('results' in response)) {
    throw new Error('Réponse Deepgram inattendue (traitement asynchrone non supporté)');
  }

  const dgResults = response.results;
  const channels = dgResults.channels?.[0];
  const alternatives = channels?.alternatives?.[0];

  if (!alternatives) {
    throw new Error('Aucun résultat de transcription');
  }

  const words = (alternatives.words ?? []) as unknown as DeepgramWord[];
  const utterancesResult = dgResults.utterances ?? [];

  // Conserver le tableau de mots individuels avec leurs timestamps précis
  const wordList: TranscriptWord[] = words.map((w) => ({
    start: typeof w.start === 'number' ? w.start : 0,
    end: typeof w.end === 'number' ? w.end : 0,
    text: w.punctuated_word || w.word || '',
    confidence: typeof w.confidence === 'number' ? w.confidence : 0,
    speaker: typeof w.speaker === 'number' ? w.speaker : undefined,
  }));

  // Construire les segments à partir des utterances (si dispo) ou des mots
  let segments: TranscriptSegment[] = [];

  if (utterancesResult.length > 0) {
    segments = utterancesResult.map((u) => ({
      start: u.start ?? 0,
      end: u.end ?? 0,
      text: u.transcript ?? '',
      confidence: u.confidence ?? 0,
      speaker: u.speaker,
    }));
  } else {
    segments = groupWordsIntoSentences(words);
  }

  const fullText = alternatives.transcript || '';

  return {
    fullText,
    segments,
    words: wordList,
    language,
    duration: segments.length > 0 ? segments[segments.length - 1].end : 0,
  };
}

/**
 * Forme brute d'un mot tel que renvoyé par Deepgram
 */
interface DeepgramWord {
  start?: number;
  end?: number;
  word?: string;
  punctuated_word?: string;
  confidence?: number;
  speaker?: number;
}

/**
 * Groupe les mots en phrases basées sur la ponctuation
 */
function groupWordsIntoSentences(words: DeepgramWord[]): TranscriptSegment[] {
  if (!words.length) return [];

  const segments: TranscriptSegment[] = [];
  let currentSegment: TranscriptSegment | null = null;

  for (const word of words) {
    if (!currentSegment) {
      currentSegment = {
        start: word.start ?? 0,
        end: word.end ?? 0,
        text: word.punctuated_word || word.word || '',
        confidence: word.confidence ?? 0,
        speaker: word.speaker,
      };
    } else {
      currentSegment.end = word.end ?? 0;
      currentSegment.text += ' ' + (word.punctuated_word || word.word || '');
      currentSegment.confidence = Math.min(currentSegment.confidence, word.confidence ?? 0);
      if (word.speaker !== undefined && currentSegment.speaker !== word.speaker) {
        // Changement de locuteur -> nouveau segment
        segments.push(currentSegment);
        currentSegment = {
          start: word.start ?? 0,
          end: word.end ?? 0,
          text: word.punctuated_word || word.word || '',
          confidence: word.confidence ?? 0,
          speaker: word.speaker,
        };
      }
    }

    // Fin de phrase détectée
    const text = word.punctuated_word || word.word || '';
    if (/[.!?]/.test(text.slice(-1))) {
      if (currentSegment) {
        segments.push(currentSegment);
        currentSegment = null;
      }
    }
  }

  if (currentSegment) {
    segments.push(currentSegment);
  }

  return segments;
}

/**
 * Version simple pour fichier audio local (non-streaming)
 */
export async function transcribeAudioFile(
  audioPath: string,
  apiKey: string,
  options?: Parameters<typeof transcribeAudioStream>[2]
): Promise<TranscriptResult> {
  const { createReadStream } = await import('node:fs');
  const stream = createReadStream(audioPath);
  return transcribeAudioStream(stream, apiKey, options);
}