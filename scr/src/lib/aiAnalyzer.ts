import {
  ClipDurationMode,
  DEFAULT_CLIP_DURATION_MODE,
  DeepSeekResponse,
  ViralMoment,
} from './types';

/**
 * Service d'analyse IA via DeepSeek
 * Identifie les moments viraux dans une transcription
 */

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DeepSeekRequest {
  model: string;
  messages: DeepSeekMessage[];
  temperature: number;
  max_tokens: number;
  response_format?: { type: 'json_object' };
}

/**
 * Instructions de découpe injectées dynamiquement dans le prompt système
 * selon le mode stratégique choisi par l'utilisateur.
 */
function buildDurationDirective(mode: ClipDurationMode): string {
  switch (mode) {
    case 'punchy':
      return `MODE DE DÉCOUPE : PUNCHY (15-30 secondes)
- Isole UNIQUEMENT des punchlines ou des hooks fulgurants.
- Chaque moment DOIT durer entre 15 et 30 secondes (endTime - startTime).
- Privilégie l'impact immédiat, la phrase choc, le rythme percutant.
- Élimine tout contexte superflu : va droit au moment le plus explosif.`;
    case 'deep':
      return `MODE DE DÉCOUPE : DEEP CONTENT (60-90 secondes ou plus) [Monétisation TikTok]
- Exige explicitement des segments de 60 à 90 secondes minimum (endTime - startTime >= 60).
- Centre chaque moment sur une explication COMPLÈTE, un développement argumenté ou une démonstration.
- Optimise pour la rétention longue et l'éligibilité à la monétisation TikTok (contenu > 1 min).
- Conserve le contexte narratif nécessaire à la compréhension autonome du clip.`;
    case 'standard':
    default:
      return `MODE DE DÉCOUPE : STANDARD (30-60 secondes)
- Chaque moment DOIT durer entre 30 et 60 secondes (endTime - startTime).
- Équilibre entre hook percutant et développement suffisant.`;
  }
}

/**
 * Analyse une transcription pour trouver les 3 moments les plus viraux
 * @param transcript - Texte complet de la transcription
 * @param segments - Segments minutés
 * @param apiKey - Clé API DeepSeek
 * @param clipDurationMode - Stratégie de découpe (punchy | standard | deep)
 * @returns Liste des 3 moments viraux avec scores et timestamps
 */
export async function analyzeViralMoments(
  transcript: string,
  segments: { start: number; end: number; text: string; confidence: number }[],
  apiKey: string,
  clipDurationMode: ClipDurationMode = DEFAULT_CLIP_DURATION_MODE
): Promise<ViralMoment[]> {
  // Construire le contexte avec timestamps
  const timedTranscript = segments
    .map((s, i) => `[${i}] ${formatTime(s.start)}-${formatTime(s.end)}: ${s.text}`)
    .join('\n');

  const durationDirective = buildDurationDirective(clipDurationMode);

  const systemPrompt = `Tu es un expert en viralité de contenu vidéo court (TikTok, Reels, Shorts).
Ta tâche : analyser une transcription minutée et identifier les 3 moments les plus viraux.

${durationDirective}

CRITÈRES DE VIRALITÉ :
1. Hook fort dans les 3 premières secondes (curiosité, choc, émotion, promesse)
2. Structure narrative : début → tension → payoff
3. Relatabilité / universalité du sujet
4. Potentiel de "share" (quotidien, astuce, révélation, humour, inspiration)
5. Densité d'information ou d'émotion par seconde

FORMAT DE RÉPONSE OBLIGATOIRE (JSON strict) :
{
  "moments": [
    {
      "rank": 1,
      "title": "Titre accrocheur (max 60 caractères)",
      "viralScore": 85,
      "hook": "La phrase exacte du hook (premiers mots)",
      "startTime": 12.5,
      "endTime": 45.3,
      "reasoning": "Pourquoi ce moment est viral (2-3 phrases)"
    },
    ...
  ]
}

RÈGLES :
- startTime/endTime doivent correspondre aux timestamps réels de la transcription
- viralScore entre 0-100
- hook = les premiers mots prononcés dans le segment
- Ne PAS inventer de timestamps, utiliser ceux fournis
- Respecter IMPÉRATIVEMENT la durée imposée par le MODE DE DÉCOUPE ci-dessus
- Exactement 3 moments, classés par score décroissant`;

  const userPrompt = `TRANSCRIPTION MINUTÉE :
${timedTranscript}

TEXTE COMPLET :
${transcript}

Analyse et retourne les 3 meilleurs moments viraux en JSON.`;

  const requestBody: DeepSeekRequest = {
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  };

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as DeepSeekResponse;

  // Parser la réponse JSON
  let parsed: { moments: ViralMoment[] };
  try {
    parsed = JSON.parse(data.choices[0].message.content);
  } catch (e) {
    throw new Error('Réponse DeepSeek invalide (pas du JSON)');
  }

  // Valider et normaliser
  const moments = parsed.moments
    .slice(0, 3)
    .map((m, i) => ({
      rank: i + 1,
      title: m.title.slice(0, 60),
      viralScore: Math.max(0, Math.min(100, Math.round(m.viralScore))),
      hook: m.hook.slice(0, 100),
      startTime: Math.max(0, m.startTime),
      endTime: Math.max(m.startTime, m.endTime),
      reasoning: m.reasoning || '',
    }))
    .sort((a, b) => b.viralScore - a.viralScore);

  return moments;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}