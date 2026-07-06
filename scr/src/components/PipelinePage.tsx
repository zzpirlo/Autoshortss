"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DropZone } from "@/components/ui/DropZone";
import { VerticalStepper } from "@/components/ui/Stepper";
import { Button } from "@/components/ui/Button";
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

const STEP_LOGS = [
  "Initialisation de l'upload…",
  "Extraction audio → flux MP3",
  "Transcription Deepgram (fr, diarize)",
  "Scoring viral DeepSeek",
];

const STEP_DELAY = 1100; // ms between optimistic step advances
const allPending = (): StepStatus[] => PIPELINE_STEPS.map(() => "pending");

/* ----------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------- */
function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    video.src = url;
  });
}

/* ----------------------------------------------------------------
 * PipelinePage
 * ---------------------------------------------------------------- */
export function PipelinePage() {
  const [phase, setPhase] = useState<PipelinePhase>("idle");
  const [statuses, setStatuses] = useState<StepStatus[]>(allPending);
  const [logs, setLogs] = useState<string[]>([]);
  const [clips, setClips] = useState<ViralMoment[]>([]);
  const [videoDuration, setVideoDuration] = useState<number | undefined>(undefined);
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const activeIndex = statuses.findIndex((s) => s === "active");
  const currentStep = activeIndex === -1 ? PIPELINE_STEPS.length : activeIndex;

  const reset = useCallback(() => {
    clearTimers();
    setPhase("idle");
    setStatuses(allPending());
    setLogs([]);
    setClips([]);
    setVideoDuration(undefined);
    setErrorMsg(undefined);
  }, [clearTimers]);

  const handleFileSelect = useCallback(
    async (file: File) => {
      clearTimers();
      setClips([]);
      setErrorMsg(undefined);
      setVideoDuration(undefined);
      setLogs([`> POST /api/projects/upload  (${file.name})`]);
      setStatuses(PIPELINE_STEPS.map((_, i) => (i === 0 ? "active" : "pending")));
      setPhase("processing");

      // Duration read client-side (no server change needed for the timeline)
      readVideoDuration(file)
        .then((d) => d != null && setVideoDuration(d))
        .catch(() => {});

      // Optimistic progression — lights up steps while waiting for the
      // (synchronous) API; stopped as soon as the response returns.
      for (let i = 1; i < PIPELINE_STEPS.length; i++) {
        const t = setTimeout(() => {
          setStatuses((prev) => {
            const next = [...prev];
            if (next[i - 1] !== "error") next[i - 1] = "completed";
            next[i] = "active";
            return next;
          });
          setLogs((prev) => [...prev, `> ${STEP_LOGS[i]}`]);
        }, STEP_DELAY * i);
        timersRef.current.push(t);
      }

      try {
        const fd = new FormData();
        fd.append("video", file);
        fd.append("projectName", file.name.replace(/\.[^/.]+$/, ""));

        const res = await fetch("/api/projects/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        clearTimers();

        if (!res.ok || !data.success) {
          throw new Error(
            data?.message || data?.errors?.join(" ; ") || "Échec du traitement serveur",
          );
        }

        const moments: ViralMoment[] = data.viralMoments ?? [];
        setStatuses(PIPELINE_STEPS.map(() => "completed"));
        setLogs((prev) => [
          ...prev,
          `✓ Pipeline terminé${moments.length ? ` — ${moments.length} moment(s) détecté(s)` : ""}`,
        ]);
        setClips(moments);
        setPhase("done");

        if (!moments.length) {
          setErrorMsg(
            "Transcription réussie, mais aucun moment viral n'a été détecté par l'IA.",
          );
        }
      } catch (err) {
        clearTimers();
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
    [clearTimers],
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
      <ResultsCarousel clips={clips} videoDuration={videoDuration} />

      {/* Reset after success */}
      {phase === "done" && (
        <div className="mt-10 flex justify-center">
          <Button variant="neon" onClick={reset}>
            Traiter une autre vidéo
          </Button>
        </div>
      )}
    </main>
  );
}
