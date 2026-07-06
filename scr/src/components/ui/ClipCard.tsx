"use client";

import { ViralMoment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import { Badge } from "./Badge";
import { Button } from "./Button";

export interface ClipCardProps {
  clip: ViralMoment;
  index: number;
  videoDuration?: number;
  onSelect?: (clip: ViralMoment) => void;
  className?: string;
}

const viralScoreColors = {
  high: "text-green-400 bg-green-500/20 border-green-500/30",      // 80-100
  medium: "text-amber-400 bg-amber-500/20 border-amber-500/30",    // 60-79
  low: "text-orange-400 bg-orange-500/20 border-orange-500/30",    // 40-59
  veryLow: "text-red-400 bg-red-500/20 border-red-500/30",         // 0-39
};

function getScoreVariant(score: number): keyof typeof viralScoreColors {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  if (score >= 40) return "low";
  return "veryLow";
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDuration(start: number, end: number): string {
  const duration = end - start;
  const mins = Math.floor(duration / 60);
  const secs = Math.floor(duration % 60);
  if (mins > 0) {
    return `${mins}min ${secs}s`;
  }
  return `${secs}s`;
}

export function ClipCard({
  clip,
  index,
  videoDuration,
  onSelect,
  className = "",
}: ClipCardProps) {
  const scoreVariant = getScoreVariant(clip.viralScore);
  const isSelected = false; // Could be managed by parent

  const timelineStart = formatTime(clip.startTime);
  const timelineEnd = formatTime(clip.endTime);
  const clipDuration = formatDuration(clip.startTime, clip.endTime);

  return (
    <Card
      variant="elevated"
      padding="lg"
      hover
      className={cn(
        "relative overflow-hidden h-full flex flex-col",
        isSelected && "ring-2 ring-cyan-500",
        className
      )}
      onClick={() => onSelect?.(clip)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(clip);
        }
      }}
      aria-label={`Clip viral #${clip.rank}: ${clip.title}`}
    >
      {/* Rank Badge - Top Left */}
      <div className="absolute top-4 left-4 z-10">
        <span className={cn(
          "inline-flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm shadow-lg",
          "bg-gradient-to-br from-cyan-500 to-violet-600 text-zinc-950"
        )}>
          #{clip.rank}
        </span>
      </div>

      {/* Viral Score Badge - Top Right */}
      <div className="absolute top-4 right-4 z-10">
        <Badge variant="viral" size="lg" className="shadow-lg">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          {clip.viralScore}/100
        </Badge>
      </div>

      <div className="flex flex-col flex-1">
        {/* Title Section */}
        <div className="mb-4">
          <h3 className="text-xl font-bold text-white leading-tight mb-2">
            {clip.title}
          </h3>

          {/* Hook preview */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3">
            <div className="flex items-center gap-2 text-xs text-zinc-400 mb-1">
              <svg className="w-3.5 h-3.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium text-zinc-300">Hook détecté</span>
            </div>
            <p className="text-zinc-200 text-sm italic leading-relaxed">
              "{clip.hook}"
            </p>
          </div>
        </div>

        {/* Timeline Section */}
        <div className="mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Timeline</span>
            <Badge variant="neon" size="sm">
              {clipDuration}
            </Badge>
          </div>

          {/* Timeline Visual */}
          <div className="relative">
            {/* Full video timeline background */}
            <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
              {/* Clip segment highlight */}
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-violet-600 rounded-full transition-all duration-500"
                style={{
                  left: videoDuration ? `${(clip.startTime / videoDuration) * 100}%` : "0%",
                  width: videoDuration ? `${((clip.endTime - clip.startTime) / videoDuration) * 100}%` : "100%",
                  position: "absolute",
                  top: 0,
                }}
                role="img"
                aria-label={`Segment vidéo de ${timelineStart} à ${timelineEnd}`}
              />
            </div>

            {/* Time markers */}
            <div className="flex justify-between mt-2 text-xs text-zinc-500 font-mono">
              <span>{timelineStart}</span>
              {videoDuration && <span>{formatTime(videoDuration)}</span>}
              <span>{timelineEnd}</span>
            </div>
          </div>
        </div>

        {/* Reasoning Section */}
        <div className="mb-4 flex-1">
          <div className="flex items-center gap-2 text-xs text-zinc-400 mb-1">
            <svg className="w-3.5 h-3.5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span className="font-medium text-zinc-300">Analyse IA</span>
          </div>
          <p className="text-zinc-300 text-sm leading-relaxed line-clamp-3">
            {clip.reasoning}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-4 border-t border-zinc-800">
          <Button
            variant="primary"
            size="sm"
            fullWidth
            leftIcon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(clip);
            }}
          >
            Prévisualiser
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            }
            onClick={(e) => e.stopPropagation()}
          >
            Exporter
          </Button>
        </div>
      </div>

      {/* Score visualization bar - bottom accent */}
      <div
        className="absolute bottom-0 left-0 right-0 h-1"
        style={{
          background: `linear-gradient(90deg, transparent ${100 - clip.viralScore}%, ${viralScoreColors[scoreVariant].split(" ")[1]} ${100 - clip.viralScore}%)`,
        }}
        aria-hidden="true"
      />
    </Card>
  );
}

export interface ClipsGridProps {
  clips: ViralMoment[];
  videoDuration?: number;
  onClipSelect?: (clip: ViralMoment) => void;
  className?: string;
}

export function ClipsGrid({
  clips,
  videoDuration,
  onClipSelect,
  className = "",
}: ClipsGridProps) {
  return (
    <div
      className={cn(
        "grid gap-6",
        "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        className
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
          onSelect={onClipSelect}
        />
      ))}
    </div>
  );
}