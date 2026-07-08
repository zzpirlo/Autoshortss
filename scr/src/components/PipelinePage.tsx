"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DropZone } from "@/components/ui/DropZone";
import { VerticalStepper } from "@/components/ui/Stepper";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { StagePanel, type StepStatus, type PipelinePhase } from "@/components/StagePanel";
import { ResultsCarousel } from "@/components/ResultsCarousel";
import { ViralMoment } from "@/lib/types";

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
 * Pipeline definition
 * ---------------------------------------------------------------- */
const PIPELINE_STEPS = [
  { label: "Upload & Métadonnées", description: "Réception du fichier vidéo", icon: <UploadIcon /> },
  { label: "Extraction Audio", description: "Conversion MP3 du flux", icon: <AudioIcon /> },
  { label: "Transcription", description: "Deepgram — FR + diarisation", icon: <TranscriptIcon /> },
  { label: "Analyse IA", description: "DeepSeek — scores viraux", icon: <SparkIcon /> },
] as const;

const allPending = (): StepStatus[] => PIPELINE_STEPS.map(() => "pending");

/* ----------------------------------------------------------------
 * Helpers : mapping statut DB -> stepper + normalisation des moments
 * ---------------------------------------------------------------- */

// Traduit le statut/stage du projet (DB) en statut visuel des 4 étapes.
// L'étape 0 (upload) est déjà terminée dès la réponse 200 PENDING.
function mapStatusToStepper(status: string, stage?: string | null): StepStatus[] {
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

function stageLog(stage?: string | null): string {
  switch (stage) {
    case "AUDIO": return "Extraction audio → flux MP3";
    case "TRANSCRIPT": return "Transcription Deepgram (fr, diarize)";
    case "ANALYSIS": return "Scoring viral DeepSeek";
    default: return "Traitement en cours…";
  }
}

function normalizeMoments(raw: Array<Record<string, unknown>>): ViralMoment[] {
  return raw.map((m) => ({
    rank: (m.rank as number) ?? 0,
    title: (m.title as string) ?? "Moment viral",
    viralScore: (m.viralScore as number) ?? 0,
    hook: (m.hook as string) ?? "",
    startTime: (m.startTime ?? m.start ?? 0) as number,
    endTime: (m.endTime ?? m.end ?? (m.startTime ?? m.start ?? 0)) as number,
    reasoning: (m.reasoning as string) ?? "",
  }));
}

/* ----------------------------------------------------------------
 * PipelinePage
 * ---------------------------------------------------------------- */
export function PipelinePage() {
  const [phase, setPhase] = useState<PipelinePhase>("idle");
  const [statuses, setStatuses] = useState<StepStatus[]>(allPending());
  const [logs, setLogs] = useState<string[]>([]);
  const [clips, setClips] = useState<ViralMoment[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [videoDuration, setVideoDuration] = useState<number | undefined>(undefined);
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);

  // État de la modale de prévisualisation vidéo
  const [preview, setPreview] = useState<{ src: string; title: string } | null>(null);

  // Dernier stage pollé (pour ne logger les transitions qu'une fois)
  const lastStageRef = useRef<string | null>(null);

  const activeIndex = statuses.findIndex((s) => s === "active");
  const currentStep = activeIndex === -1 ? PIPELINE_STEPS.length : activeIndex;

  const reset = useCallback(() => {
    setPhase("idle");
    setStatuses(allPending());
    setLogs([]);
    setClips([]);
    setProjectId(undefined);
    setVideoDuration(undefined);
    setErrorMsg(undefined);
    setPreview(null);
    lastStageRef.current = null;
  }, []);

  // Prévisualisation : ouvre la modale avec le flux vidéo segmenté
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error || "Échec de l'export");
      }
      return { url: data.url as string };
    },
    [projectId],
  );

  // Polling de l'état du projet (déclenché après l'upload, tant que phase=processing)
  useEffect(() => {
    if (!projectId || phase !== "processing") return;

    let active = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        const data = await res.json().catch(() => ({}));
        if (!active) return;

        if (data.status === "COMPLETED") {
          const moments = normalizeMoments((data.viralMoments as Array<Record<string, unknown>>) ?? []);
          setStatuses(mapStatusToStepper("COMPLETED"));
          setLogs((prev) => [
            ...prev,
            `✓ Pipeline terminé${moments.length ? ` — ${moments.length} moment(s) détecté(s)` : ""}`,
          ]);
          setClips(moments);
          setPhase("done");
          if (moments.length === 0) {
            setErrorMsg("Transcription réussie, mais aucun moment viral n'a été détecté par l'IA.");
          }
        } else if (data.status === "FAILED") {
          setStatuses(mapStatusToStepper("FAILED", data.stage));
          setErrorMsg(data.error || "Échec du traitement");
          setLogs((prev) => [...prev, `✗ ${data.error || "Erreur inconnue"}`]);
          setPhase("error");
        } else {
          // PENDING ou PROCESSING : reflète l'avancement réel
          setStatuses(mapStatusToStepper(data.status, data.stage));
          if (data.stage && data.stage !== lastStageRef.current) {
            lastStageRef.current = data.stage as string;
            setLogs((prev) => [...prev, `> ${stageLog(data.stage)}`]);
          }
        }
      } catch {
        // erreur réseau temporaire : on réessaiera au prochain tick
      }
    }, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [projectId, phase]);

  const handleFileSelect = useCallback(
    async (file: File) => {
      setClips([]);
      setErrorMsg(undefined);
      setVideoDuration(undefined);
      setLogs([`> POST /api/projects/upload  (${file.name})`]);
      setStatuses(PIPELINE_STEPS.map((_, i) => (i === 0 ? "active" : "pending")));
      setPhase("processing");

      // Duration read client-side (no server change needed for the timeline)
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
        const data = await res.json().catch(() => ({}));

        // L'upload renvoie 200 + projectId immédiatement (traitement async).
        if (!res.ok || !data.success || !data.projectId) {
          throw new Error(
            data?.message || (data?.errors && data.errors.join(" ; ")) || "Échec de l'upload",
          );
        }

        // Projet créé : on démarre le polling (géré par useEffect ci-dessus)
        setProjectId(data.projectId as string);
        setStatuses(mapStatusToStepper("PENDING"));
        setLogs((prev) => [
          ...prev,
          `> Projet créé (${data.projectId}) — traitement en arrière-plan…`,
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        setErrorMsg(msg);
        setStatuses((prev) => {
          const next = [...prev];
          const idx = next.findIndex((s) => s === "active");
          next[idx === -1 ? next.length - 1 : idx] = "error";
          return next;
        });
        setLogs((prev) => [...prev, `✗ ${msg}`]);
        setPhase("error");
      }
    },
    [],
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      {/* Hero */}
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

      {/* Upload zone */}
      <DropZone
        onFileSelect={handleFileSelect}
        disabled={phase === "processing"}
        className="mb-10"
      />

      {/* Error banner */}
      {phase === "error" && errorMsg && (
        <div className="mb-10 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {errorMsg}
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={reset}>
              Réessayer
            </Button>
          </div>
        </div>
      )}

      {/* Pipeline grid: sticky stepper + active stage panel */}
      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <VerticalStepper
            steps={PIPELINE_STEPS as unknown as Array<{
              label: string;
              description?: string;
              icon: React.ReactNode;
            }>}
            currentStep={currentStep}
            stepStatuses={statuses}
          />
        </aside>

        <section>
          <StagePanel steps={PIPELINE_STEPS as unknown as Array<{
            label: string;
            description?: string;
            icon: React.ReactNode;
          }>} statuses={statuses} logs={logs} phase={phase} />
        </section>
      </div>

      {/* Results */}
      <ResultsCarousel
        clips={clips}
        videoDuration={videoDuration}
        projectId={projectId}
        onPreview={handlePreview}
        onExport={handleExport}
      />

      {/* Reset after success */}
      {phase === "done" && (
        <div className="mt-10 flex justify-center">
          <Button variant="neon" onClick={reset}>
            Traiter une autre vidéo
          </Button>
        </div>
      )}

      {/* Modale de prévisualisation vidéo */}
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
