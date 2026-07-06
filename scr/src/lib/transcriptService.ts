import { DeepgramClient } from '@deepgram/sdk';
import { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';

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

export interface TranscriptResult {
  fullText: string;
  segments: TranscriptSegment[];
  language: string;
  duration: number;
}

/**
 * Transcrit un flux audio MP3 via Deepgram
 * @param audioStream - Stream audio MP3 (16kHz mono)
 * @param apiKey - Clé API Deepgram
 * @param options - Options de transcription
 */
export async function transcribeAudioStream(
  audioStream: Readable,
  apiKey: string,
  options: {
    language?: string;
    diarize?: boolean;
    smartFormat?: boolean;
    punctuate?: boolean;
    utterances?: boolean;
  } = {}
): Promise<TranscriptResult> {
  const deepgram = new DeepgramClient(apiKey);

  const {
    language = 'fr',
    diarize = true,
    smartFormat = true,
    punctuate = true,
    utterances = true
  } = options;

  // Convertir le stream Readable en buffer pour l'upload
  // Deepgram SDK attend un buffer ou un stream convertible
  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const audioBuffer = Buffer.concat(chunks);

  // Configurer la requête Deepgram
  const response = await deepgram.listen.prerecorded.transcribeFile(
    audioBuffer,
    {
      model: 'nova-2',
      language,
      diarize,
      smart_format: smartFormat,
      punctuate,
      utterances,
      // Options pour la détection de locuteurs
      multichannel: false,
      // Obtenir les timestamps au niveau mot
      words: true,
    }
  );

  // Parser la réponse (format SDK v5+)
  const result = response.result;
  const channels = result?.results?.channels?.[0];
  const alternatives = channels?.alternatives?.[0];

  if (!alternatives) {
    throw new Error('Aucun résultat de transcription');
  }

  const words = alternatives.words || [];
  const paragraphs = channels?.alternatives?.[0]?.paragraphs?.paragraphs || [];

  // Construire les segments à partir des utterances (si disponibles) ou des paragraphes
  let segments: TranscriptSegment[] = [];

  if (utterances && result?.results?.utterances) {
    segments = result.results.utterances.map((u: any) => ({
      start: u.start,
      end: u.end,
      text: u.transcript,
      confidence: u.confidence || 0,
      speaker: u.speaker,
    }));
  } else if (paragraphs.length > 0) {
    segments = paragraphs.map((p: any) => ({
      start: p.start,
      end: p.end,
      text: p.text,
      confidence: p.confidence || 0,
      speaker: p.speaker,
    }));
  } else {
    // Fallback: grouper les mots en phrases
    segments = groupWordsIntoSentences(words);
  }

  const fullText = alternatives.transcript || '';
  const confidence = alternatives.confidence || 0;

  return {
    fullText,
    segments,
    language,
    duration: segments.length > 0 ? segments[segments.length - 1].end : 0,
  };
}

/**
 * Groupe les mots en phrases basées sur la ponctuation
 */
function groupWordsIntoSentences(words: any[]): TranscriptSegment[] {
  if (!words.length) return [];

  const segments: TranscriptSegment[] = [];
  let currentSegment: TranscriptSegment | null = null;

  for (const word of words) {
    if (!currentSegment) {
      currentSegment = {
        start: word.start,
        end: word.end,
        text: word.punctuated_word || word.word,
        confidence: word.confidence || 0,
        speaker: word.speaker,
      };
    } else {
      currentSegment.end = word.end;
      currentSegment.text += ' ' + (word.punctuated_word || word.word);
      currentSegment.confidence = Math.min(currentSegment.confidence, word.confidence || 0);
      if (word.speaker !== undefined && currentSegment.speaker !== word.speaker) {
        // Changement de locuteur -> nouveau segment
        segments.push(currentSegment);
        currentSegment = {
          start: word.start,
          end: word.end,
          text: word.punctuated_word || word.word,
          confidence: word.confidence || 0,
          speaker: word.speaker,
        };
      }
    }

    // Fin de phrase détectée
    const text = word.punctuated_word || word.word;
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