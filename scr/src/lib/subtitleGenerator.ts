/**
 * Générateur de sous-titres dynamiques au format ASS (Advanced SubStation Alpha)
 * pour le style "CapCut" : mots en gros, gras, centrés, jaune (mot en cours) /
 * blanc (déjà prononcé), avec une bordure noire épaisse. Le surlignage se fait
 * mot à mot via les balises karaoke `\k` d'ASS, synchronisées sur les timestamps
 * précis de chaque mot fournis par Deepgram.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface TimedWord {
  text: string;
  start: number; // secondes
  end: number; // secondes
}

export interface SubtitleStyleOptions {
  /** Police (libass utilisera une substitution si absente, ex: Arial Black) */
  fontName?: string;
  /** Taille en px (canvas 1080x1920) */
  fontSize?: number;
  /** Couleur du mot EN COURS (karaoke) — format ASS &HAABBGGRR */
  primaryColour?: string;
  /** Couleur des mots DÉJÀ prononcés — format ASS &HAABBGGRR */
  secondaryColour?: string;
  /** Couleur de la bordure — format ASS &HAABBGGRR */
  outlineColour?: string;
  /** Épaisseur de la bordure (px) */
  outline?: number;
  /** Alignement ASS : 2 = bas-centré */
  alignment?: number;
  /** Marge verticale (px) depuis le bas du canvas 1080x1920 */
  marginV?: number;
  /** Nombre max de mots par ligne de sous-titre */
  maxWordsPerCue?: number;
  /** Surlignage karaoke mot-à-mot (défaut: true) */
  karaoke?: boolean;
}

const DEFAULTS = {
  fontName: 'Arial Black',
  fontSize: 100,
  primaryColour: '&H0000FFFF', // jaune opaque (R=FF, G=FF, B=00)
  secondaryColour: '&H00FFFFFF', // blanc opaque
  outlineColour: '&H00000000', // noir opaque
  outline: 5,
  alignment: 2,
  marginV: 260,
  // Style "CapCut" : 1 à 3 mots max par séquence pour un défilement très rapide
  // synchronisé sur la parole.
  maxWordsPerCue: 3,
  karaoke: true,
};

/** Formate une durée en secondes au format ASS `H:MM:SS.cc` (centièmes) */
function formatAssTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalCs = Math.round(safe * 100);
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60) % 60;
  const h = Math.floor(totalS / 3600);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/** Échappe les caractères spéciaux ASS dans le texte d'un mot */
function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}');
}

/** Concatène les mots en "cues" (lignes) par ponctuation / nombre max de mots */
function buildCues(words: TimedWord[], maxWordsPerCue: number): TimedWord[][] {
  const cues: TimedWord[][] = [];
  let current: TimedWord[] = [];

  const flush = () => {
    if (current.length) {
      cues.push(current);
      current = [];
    }
  };

  for (const w of words) {
    current.push(w);
    const endsSentence = /[.!?…]$/.test(w.text.trim());
    if (endsSentence || current.length >= maxWordsPerCue) {
      flush();
    }
  }
  flush();
  return cues;
}

/** Construit le texte d'un cue, avec surlignage karaoke mot-à-mot si demandé */
function buildCueText(cue: TimedWord[], karaoke: boolean): string {
  if (!karaoke) {
    return cue.map((w) => escapeAssText(w.text)).join(' ');
  }

  let out = '';
  for (let i = 0; i < cue.length; i++) {
    const w = cue[i];
    // Durée (centièmes) pendant laquelle CE mot reste surligné avant le suivant
    const next = cue[i + 1];
    const durSec = next ? next.start - w.start : w.end - w.start;
    const durCs = Math.max(1, Math.round(durSec * 100));
    out += `{\\k${durCs}}${escapeAssText(w.text)}`;
    if (next) out += ' ';
  }
  return out;
}

/**
 * Génère le contenu complet d'un fichier `.ass` (sous-titres CapCut-style)
 * à partir de mots minutés.
 */
export function generateAssSubtitles(
  words: TimedWord[],
  opts: SubtitleStyleOptions = {},
): string {
  const o = { ...DEFAULTS, ...opts };

  const lines: string[] = [];
  lines.push('[Script Info]');
  lines.push('ScriptType: v4.00+');
  lines.push('PlayResX: 1080');
  lines.push('PlayResY: 1920');
  lines.push('WrapStyle: 2');
  lines.push('');
  lines.push('[V4+ Styles]');
  lines.push(
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  );
  lines.push(
    `Style: Default,${o.fontName},${o.fontSize},${o.primaryColour},${o.secondaryColour},${o.outlineColour},&H00000000,-1,0,0,0,100,100,0,0,1,${o.outline},0,${o.alignment},60,60,${o.marginV},1`,
  );
  lines.push('');
  lines.push('[Events]');
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  if (words.length) {
    // Contrainte CapCut stricte : jamais plus de 3 mots par séquence
    const maxPerCue = Math.min(3, Math.max(1, Math.round(o.maxWordsPerCue)));
    const cues = buildCues(words, maxPerCue);
    for (const cue of cues) {
      const start = formatAssTime(cue[0].start);
      const end = formatAssTime(cue[cue.length - 1].end);
      const text = buildCueText(cue, o.karaoke);
      lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
    }
  }

  return lines.join('\r\n') + '\r\n';
}

/**
 * Génère un fichier `.ass` temporaire de sous-titres "CapCut" dans un dossier
 * donné (ex: `data/uploads/`) et renvoie son chemin absolu.
 *
 * Les timestamps des mots sont **rebasés** sur `timeOffset` (en secondes) : lors
 * d'un découpage FFmpeg avec `-ss` en amont de `-i`, la timeline de sortie
 * redémarre à 0. Sans ce rebasage, les sous-titres (calés sur le temps absolu de
 * la vidéo source) ne s'afficheraient jamais sur le clip.
 *
 * @param words - Mots minutés (temps absolus de la vidéo source)
 * @param dir - Dossier de destination du fichier `.ass` (créé si absent)
 * @param timeOffset - Décalage (s) à soustraire à chaque timestamp (= début du clip)
 * @param opts - Options de style
 * @returns Chemin absolu du fichier `.ass` généré
 */
export async function writeSubtitleFile(
  words: TimedWord[],
  dir: string,
  timeOffset = 0,
  opts: SubtitleStyleOptions = {},
): Promise<string> {
  const rebased: TimedWord[] = words.map((w) => ({
    text: w.text,
    start: Math.max(0, w.start - timeOffset),
    end: Math.max(0, w.end - timeOffset),
  }));

  const content = generateAssSubtitles(rebased, opts);

  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `subtitles-${randomUUID()}.ass`);
  await writeFile(filePath, content, 'utf8');

  return filePath;
}
