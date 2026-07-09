"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DropZone } from "@/components/ui/DropZone";
import { VerticalStepper } from "@/components/ui/Stepper";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ClipCard } from "@/components/ui/ClipCard";
import type { StepStatus } from "@/components/StagePanel";
import { ClipDurationMode, ViralMoment } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------------
 * Screens exclusifs du Wizard (une seule phase visible à la fois)
 * ---------------------------------------------------------------- */
type WizardScreen = "upload" | "pipeline" | "results" | "error";

/* ----------------------------------------------------------------
 * Réponse de polling GET /api/projects/[id]
 * ---------------------------------------------------------------- */
type ProjectStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
type ProjectStage = "AUDIO" | "TRANSCRIPT" | "ANALYSIS" | string;

interface ProjectPollResponse {
  id: string;
  name?: string;
  status: ProjectStatus;
  stage?: ProjectStage | null;
  error?: string | null;
  viralMoments?: unknown;
  videoClip?: { duration?: number | null } | null;
}

/* ----------------------------------------------------------------
 * Icons (inline, no extra deps)
 * ---------------------------------------------------------------- */
function UploadIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
  );
}
function AudioIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19V6l12-3v13M9 19c0 1.1-1.34 2-3 2s-3-.9-3-2 1.34-2 3-2 3 .9 3 2zm12-3c0 1.1-1.34 2-3 2s-3-.9-3-2 1.34-2 3-2 3 .9 3 2z" />
    </svg>
  );
}
function TranscriptIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 10h16M4 14h10M4 18h7" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

/* ----------------------------------------------------------------
 * Définition du pipeline (4 étapes)
 * ---------------------------------------------------------------- */
interface StepDefinition {
  label: string;
  description?: string;
  icon: React.ReactNode;
}

const PIPELINE_STEPS: StepDefinition[] = [
  { label: "Upload & Métadonnées", description: "Réception du fichier vidéo", icon: <UploadIcon /> },
  { label: "Extraction Audio", description: "Conversion MP3 du flux (FFmpeg)", icon: <AudioIcon /> },
  { label: "Transcription", description: "Deepgram — FR + diarisation", icon: <TranscriptIcon /> },
  { label: "Analyse IA", description: "DeepSeek — scores viraux", icon: <SparkIcon /> },
];

const allPending = (): StepStatus[] => PIPELINE_STEPS.map(() => "pending");

/* ----------------------------------------------------------------
 * Helpers : mapping statut DB -> stepper + normalisation des moments
 * ---------------------------------------------------------------- */

// Traduit le statut/stage du projet (DB) en statut visuel des 4 étapes.
// L'étape 0 (upload) est déjà terminée dès la réponse 200 PENDING.
function mapStatusToStepper(status: ProjectStatus, stage?: ProjectStage | null): StepStatus[] {
  const s: StepStatus[] = ["completed", "pending", "pending", "pending"];
  if (status === "PENDING") return s;
  if (status === "PROCESSING") {
    if (stage === "AUDIO") s[1] = "active";
    else if (stage === "TRANSCRIPT") { s[1] = "completed"; s[2] = "active"; }
    else if (stage === "ANALYSIS") { s[1] = "completed"; s[2] = "completed"; s[3] = "active"; }
    else s[1] = "active";
    return s;
  }
  if (status === "COMPLETED") return ["completed", "completed", "completed", "completed"];
  if (status === "FAILED") {
    if (stage === "AUDIO") s[1] = "error";
    else if (stage === "TRANSCRIPT") { s[1] = "completed"; s[2] = "error"; }
    else if (stage === "ANALYSIS") { s[1] = "completed"; s[2] = "completed"; s[3] = "error"; }
    else s[3] = "error";
    return s;
  }
  return s;
}

// Normalise les moments viraux (le champ Prisma Json peut arriver en objet ou en string).
function normalizeMoments(raw: unknown): ViralMoment[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];

  return arr.map((entry): ViralMoment => {
    const m = (entry ?? {}) as Record<string, unknown>;
    const start = (m.startTime ?? m.start ?? 0) as number;
    const end = (m.endTime ?? m.end ?? start) as number;
    return {
      rank: (m.rank as number) ?? 0,
      title: (m.title as string) ?? "Moment viral",
      viralScore: (m.viralScore as number) ?? 0,
      hook: (m.hook as string) ?? "",
      startTime: start,
      endTime: end,
      reasoning: (m.reasoning as string) ?? "",
    };
  });
}

/* ----------------------------------------------------------------
 * Sélecteur stratégique de durée des clips (atomic, Dark/Tech)
 * ---------------------------------------------------------------- */
interface ClipDurationOption {
  value: ClipDurationMode;
  label: string;
  range: string;
  hint?: string;
}

const CLIP_DURATION_OPTIONS: ClipDurationOption[] = [
  { value: "punchy", label: "Punchy", range: "15-30s", hint: "Hooks fulgurants" },
  { value: "standard", label: "Standard", range: "30-60s", hint: "Équilibré" },
  {
    value: "deep",
    label: "Deep Content",
    range: "60-90s+",
    hint: "Monétisation TikTok",
  },
];

interface ClipDurationSelectorProps {
  value: ClipDurationMode;
  onChange: (mode: ClipDurationMode) => void;
  disabled?: boolean;
}

/**
 * Sélecteur horizontal exclusif (radiogroup) — onglets rétroéclairés néon.
 * Composant pur : ne gère aucun état, tout remonte via onChange.
 */
function ClipDurationSelector({ value, onChange, disabled }: ClipDurationSelectorProps) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 flex items-center justify-center gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-cyan-400">
          Stratégie de découpe
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label="Durée stratégique des clips"
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        {CLIP_DURATION_OPTIONS.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={cn(
                "group relative flex flex-col items-center gap-1 rounded-xl border-2 px-4 py-3",
                "text-center transition-all duration-200 focus:outline-none",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected
                  ? "border-cyan-400 bg-cyan-500/10 shadow-[0_0_25px_rgba(6,182,212,0.25)] ring-2 ring-cyan-500/30"
                  : "border-zinc-700 bg-zinc-950/60 hover:border-cyan-500/50 hover:bg-zinc-900",
              )}
            >
              {selected && (
                <span className="absolute right-2 top-2 h-2 w-2 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
              )}
              <span
                className={cn(
                  "text-sm font-semibold tracking-tight",
                  selected ? "text-cyan-100" : "text-zinc-200",
                )}
              >
                {opt.label}
              </span>
              <span
                className={cn(
                  "font-mono text-xs",
                  selected ? "text-cyan-300" : "text-zinc-500",
                )}
              >
                {opt.range}
              </span>
              {opt.hint && (
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-wider",
                    selected ? "text-cyan-400/80" : "text-zinc-600",
                  )}
                >
                  {opt.hint}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------
 * PipelinePage — Wizard exclusif à 3 phases
 * ---------------------------------------------------------------- */
export function PipelinePage() {
  const [screen, setScreen] = useState<WizardScreen>("upload");
  const [statuses, setStatuses] = useState<StepStatus[]>(allPending());
  const [clips, setClips] = useState<ViralMoment[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [videoDuration, setVideoDuration] = useState<number | undefined>(undefined);
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);
  const [statusLabel, setStatusLabel] = useState<string>("Initialisation du pipeline…");

  // État de la modale de prévisualisation vidéo
  const [preview, setPreview] = useState<{ src: string; title: string } | null>(null);

  // Import Premium par URL (YouTube)
  const [urlValue, setUrlValue] = useState<string>("");
  const [urlSubmitting, setUrlSubmitting] = useState<boolean>(false);

  // Stratégie de découpe des clips (transmise à l'IA)
  const [clipDurationMode, setClipDurationMode] = useState<ClipDurationMode>("standard");

  const activeIndex = statuses.findIndex((s) => s === "active");
  const currentStep = activeIndex === -1 ? PIPELINE_STEPS.length : activeIndex;

  const reset = useCallback(() => {
    setScreen("upload");
    setStatuses(allPending());
    setClips([]);
    setProjectId(undefined);
    setVideoDuration(undefined);
    setErrorMsg(undefined);
    setStatusLabel("Initialisation du pipeline…");
    setPreview(null);
    setUrlValue("");
    setUrlSubmitting(false);
    setClipDurationMode("standard");
  }, []);

  // Prévisualisation : ouvre la modale avec le flux vidéo fragmenté
  const handlePreview = useCallback(
    (clip: ViralMoment) => {
      if (!projectId) return;
      const src = `/api/video/preview?projectId=${encodeURIComponent(
        projectId,
      )}&start=${clip.startTime}&end=${clip.endTime}`;
      setPreview({ src, title: clip.title });
    },
    [projectId],
  );

  // Export : POST vers l'API, renvoie l'URL du short 9:16 généré
  const handleExport = useCallback(
    async (clip: ViralMoment): Promise<{ url: string }> => {
      if (!projectId) throw new Error("Projet introuvable");
      const res = await fetch("/api/video/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          start: clip.startTime,
          end: clip.endTime,
        }),
      });
      const data: { success?: boolean; url?: string; error?: string } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok || !data.success || !data.url) {
        throw new Error(data?.error || "Échec de l'export");
      }
      return { url: data.url };
    },
    [projectId],
  );

  // Polling de l'état du projet (actif uniquement pendant la phase pipeline)
  useEffect(() => {
    if (!projectId || screen !== "pipeline") return;

    let active = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        const data: ProjectPollResponse = await res.json().catch(() => ({} as ProjectPollResponse));
        if (!active) return;

        if (data.status === "COMPLETED") {
          const moments = normalizeMoments(data.viralMoments);
          setStatuses(mapStatusToStepper("COMPLETED"));
          setClips(moments);
          if (typeof data.videoClip?.duration === "number") {
            setVideoDuration(data.videoClip.duration);
          }
          if (moments.length === 0) {
            setErrorMsg("Transcription réussie, mais aucun moment viral n'a été détecté par l'IA.");
          }
          // PHASE 3 : bascule vers le tableau de bord des résultats
          setScreen("results");
        } else if (data.status === "FAILED") {
          setStatuses(mapStatusToStepper("FAILED", data.stage));
          setErrorMsg(data.error || "Échec du traitement");
          setScreen("error");
        } else {
          // PENDING ou PROCESSING : reflète l'avancement réel du stepper
          setStatuses(mapStatusToStepper(data.status, data.stage));
          setStatusLabel(stageStatusLabel(data.status, data.stage));
        }
      } catch {
        // erreur réseau temporaire : on réessaiera au prochain tick
      }
    }, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [projectId, screen]);

  const handleFileSelect = useCallback(async (file: File) => {
    setClips([]);
    setErrorMsg(undefined);
    setVideoDuration(undefined);
    setStatusLabel("Envoi du fichier vidéo…");
    setStatuses(PIPELINE_STEPS.map((_, i) => (i === 0 ? "active" : "pending")));
    // PHASE 2 : on quitte immédiatement la DropZone pour le stepper
    setScreen("pipeline");

    // Lecture de la durée côté client (timeline des clips, sans appel serveur)
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (Number.isFinite(video.duration)) setVideoDuration(video.duration);
    };
    video.onerror = () => URL.revokeObjectURL(url);
    video.src = url;

    try {
      const fd = new FormData();
      fd.append("video", file);
      fd.append("projectName", file.name.replace(/\.[^/.]+$/, ""));
      fd.append("clipDurationMode", clipDurationMode);

      const res = await fetch("/api/projects/upload", { method: "POST", body: fd });
      const data: { success?: boolean; projectId?: string; message?: string; errors?: string[] } =
        await res.json().catch(() => ({}));

      // L'upload renvoie 200 + projectId immédiatement (traitement asynchrone).
      if (!res.ok || !data.success || !data.projectId) {
        throw new Error(
          data?.message || (data?.errors && data.errors.join(" ; ")) || "Échec de l'upload",
        );
      }

      // Projet créé : on démarre le polling (géré par useEffect ci-dessus)
      setProjectId(data.projectId);
      setStatuses(mapStatusToStepper("PENDING"));
      setStatusLabel("Projet créé — traitement en arrière-plan…");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setErrorMsg(msg);
      setStatuses((prev) => {
        const next = [...prev];
        const idx = next.findIndex((s) => s === "active");
        next[idx === -1 ? next.length - 1 : idx] = "error";
        return next;
      });
      setScreen("error");
    }
  }, [clipDurationMode]);

  // Import par URL (YouTube) : POST vers la nouvelle API, puis bascule en Phase 2.
  const handleUrlSubmit = useCallback(async () => {
    const url = urlValue.trim();
    if (!url || urlSubmitting) return;

    setUrlSubmitting(true);
    setClips([]);
    setErrorMsg(undefined);
    setVideoDuration(undefined);
    setStatusLabel("Récupération de la vidéo YouTube…");
    setStatuses(PIPELINE_STEPS.map((_, i) => (i === 0 ? "active" : "pending")));
    // PHASE 2 : on quitte immédiatement l'écran d'upload pour le stepper
    setScreen("pipeline");

    try {
      const res = await fetch("/api/projects/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, clipDurationMode }),
      });
      const data: { success?: boolean; projectId?: string; message?: string; errors?: string[] } =
        await res.json().catch(() => ({}));

      // L'API renvoie 200 + projectId immédiatement (traitement asynchrone).
      if (!res.ok || !data.success || !data.projectId) {
        throw new Error(
          data?.message || (data?.errors && data.errors.join(" ; ")) || "Échec de l'import URL",
        );
      }

      // Projet créé : on démarre le polling (géré par useEffect ci-dessus)
      setProjectId(data.projectId);
      setStatuses(mapStatusToStepper("PENDING"));
      setStatusLabel("Projet créé — téléchargement en arrière-plan…");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setErrorMsg(msg);
      setStatuses((prev) => {
        const next = [...prev];
        const idx = next.findIndex((s) => s === "active");
        next[idx === -1 ? next.length - 1 : idx] = "error";
        return next;
      });
      setScreen("error");
    } finally {
      setUrlSubmitting(false);
    }
  }, [urlValue, urlSubmitting, clipDurationMode]);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col px-6 py-12">
      {/* Hero — cadre persistant de l'application */}
      <header className="mb-10 text-center">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-cyan-400">
          AutoShorts · AI Pipeline
        </span>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Transformez vos vidéos en{" "}
          <span className="bg-gradient-to-r from-cyan-400 to-violet-500 bg-clip-text text-transparent">
            clips viraux
          </span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-zinc-400">
          Déposez une vidéo : extraction audio, transcription et analyse IA se
          déclenchent en cascade. Suivez chaque étape en temps réel.
        </p>
      </header>

      {/* ================= PHASE 1 — UPLOAD / URL ================= */}
      {screen === "upload" && (
        <section
          key="phase-upload"
          className="flex flex-1 animate-fade-in flex-col items-center justify-center gap-10"
        >
          {/* Sélecteur stratégique de durée des clips (avant DropZone & URL) */}
          <ClipDurationSelector
            value={clipDurationMode}
            onChange={setClipDurationMode}
            disabled={urlSubmitting}
          />

          <div className="grid w-full max-w-5xl grid-cols-1 items-stretch gap-6 lg:grid-cols-[1fr_auto_1fr]">
            {/* --- Gauche : DropZone (upload fichier) --- */}
            <div className="w-full">
              <DropZone onFileSelect={handleFileSelect} />
            </div>

            {/* --- Milieu : séparateur "OU" --- */}
            <div className="flex items-center justify-center lg:flex-col">
              <span className="hidden w-px flex-1 bg-gradient-to-b from-transparent via-zinc-700 to-transparent lg:block" />
              <span className="mx-4 my-3 flex h-10 w-10 items-center justify-center rounded-full border border-cyan-500/40 bg-zinc-900 font-mono text-xs font-semibold uppercase tracking-widest text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.15)]">
                OU
              </span>
              <span className="hidden w-px flex-1 bg-gradient-to-b from-transparent via-zinc-700 to-transparent lg:block" />
            </div>

            {/* --- Droite : import par URL YouTube (Premium) --- */}
            <div className="w-full">
              <Card variant="outlined" padding="lg" className="flex h-full flex-col justify-center">
                <div className="flex flex-col items-center gap-6 text-center">
                  <div className="flex items-center gap-2">
                    <Badge variant="viral" size="sm">
                      Premium
                    </Badge>
                    <span className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Import par URL
                    </span>
                  </div>

                  <div className="relative animate-float text-cyan-400">
                    <svg className="h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                    </svg>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-2xl font-semibold tracking-tight text-white">
                      Collez un lien YouTube
                    </h3>
                    <p className="max-w-md text-zinc-400">
                      La vidéo est importée puis analysée automatiquement
                      <span className="ml-1 text-zinc-500">(max 20 min)</span>
                    </p>
                  </div>

                  <div className="flex w-full max-w-md flex-col gap-3">
                    <input
                      type="url"
                      inputMode="url"
                      value={urlValue}
                      onChange={(e) => setUrlValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleUrlSubmit();
                        }
                      }}
                      placeholder="https://www.youtube.com/watch?v=…"
                      disabled={urlSubmitting}
                      aria-label="URL de la vidéo YouTube"
                      className={cn(
                        "w-full rounded-xl border-2 border-cyan-500/40 bg-zinc-950/60 px-4 py-3",
                        "font-mono text-sm text-cyan-100 placeholder:text-zinc-600",
                        "transition-all duration-200 focus:border-cyan-400 focus:outline-none",
                        "focus:shadow-[0_0_25px_rgba(6,182,212,0.2)] focus:ring-2 focus:ring-cyan-500/30",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                      )}
                    />
                    <Button
                      variant="neon"
                      size="lg"
                      fullWidth
                      isLoading={urlSubmitting}
                      disabled={!urlValue.trim()}
                      onClick={() => void handleUrlSubmit()}
                    >
                      Traiter l&apos;URL
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </section>
      )}

      {/* ================= PHASE 2 — PIPELINE ================= */}
      {screen === "pipeline" && (
        <section
          key="phase-pipeline"
          className="flex flex-1 animate-fade-in flex-col items-center justify-center"
        >
          <Card variant="glass" padding="lg" className="w-full max-w-xl">
            <div className="mb-8 flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">
                Pipeline en cours
              </span>
              <Badge variant="neon" size="sm" dot>
                {statusLabel}
              </Badge>
            </div>

            <div className="flex justify-center">
              <VerticalStepper
                steps={PIPELINE_STEPS}
                currentStep={currentStep}
                stepStatuses={statuses}
              />
            </div>

            <p className="mt-8 text-center text-sm text-zinc-500">
              Ne fermez pas cette page — le traitement se poursuit en temps réel.
            </p>
          </Card>
        </section>
      )}

      {/* ================= PHASE 3 — RÉSULTATS ================= */}
      {screen === "results" && (
        <section key="phase-results" className="flex-1 animate-scale-in">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold tracking-tight text-white">
                Clips viraux détectés
              </h2>
              {clips.length > 0 && (
                <Badge variant="viral" size="lg">
                  {clips.length} moment{clips.length > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <Button variant="neon" onClick={reset}>
              Traiter une autre vidéo
            </Button>
          </div>

          {clips.length === 0 ? (
            <Card variant="glass" padding="lg" className="text-center">
              <p className="text-zinc-400">
                {errorMsg ?? "Aucun moment viral n'a été détecté par l'IA."}
              </p>
            </Card>
          ) : (
            <div
              className={cn(
                "grid gap-6",
                "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
              )}
              role="list"
              aria-label="Clips viraux détectés"
            >
              {clips.map((clip, index) => (
                <ClipCard
                  key={clip.rank || index}
                  clip={clip}
                  index={index}
                  videoDuration={videoDuration}
                  projectId={projectId}
                  onPreview={handlePreview}
                  onExport={handleExport}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ================= ÉTAT ERREUR ================= */}
      {screen === "error" && (
        <section
          key="phase-error"
          className="flex flex-1 animate-fade-in items-center justify-center"
        >
          <Card variant="glass" padding="lg" className="w-full max-w-xl text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 text-red-400">
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white">Le pipeline a échoué</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-red-300">
              {errorMsg ?? "Une erreur est survenue pendant le traitement."}
            </p>
            <div className="mt-6 flex justify-center">
              <Button variant="outline" onClick={reset}>
                Réessayer
              </Button>
            </div>
          </Card>
        </section>
      )}

      {/* Modale de prévisualisation vidéo (flux fragmenté) */}
      <Modal isOpen={preview !== null} onClose={() => setPreview(null)} title={preview?.title}>
        {preview && (
          <video
            key={preview.src}
            src={preview.src}
            controls
            autoPlay
            className="w-full rounded-xl bg-black"
          >
            Votre navigateur ne supporte pas la lecture de vidéos.
          </video>
        )}
      </Modal>
    </main>
  );
}

/* ----------------------------------------------------------------
 * Libellé court de l'étape courante (pour le badge de statut)
 * ---------------------------------------------------------------- */
function stageStatusLabel(status: ProjectStatus, stage?: ProjectStage | null): string {
  if (status === "PENDING") return "En file d'attente";
  switch (stage) {
    case "AUDIO":
      return "Extraction audio";
    case "TRANSCRIPT":
      return "Transcription";
    case "ANALYSIS":
      return "Analyse virale";
    default:
      return "Traitement…";
  }
}
