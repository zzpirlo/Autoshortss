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
import { ViralMoment } from "@/lib/types";
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
  }, []);

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

      {/* ================= PHASE 1 — UPLOAD ================= */}
      {screen === "upload" && (
        <section
          key="phase-upload"
          className="flex flex-1 animate-fade-in items-center justify-center"
        >
          <div className="w-full max-w-2xl">
            <DropZone onFileSelect={handleFileSelect} />
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
