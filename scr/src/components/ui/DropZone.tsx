"use client";

import { DragEvent, useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import { Button } from "./Button";
import { Badge } from "./Badge";

export interface DropZoneProps {
  onFileSelect: (file: File) => void;
  acceptedTypes?: string[];
  maxSizeMB?: number;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function DropZone({
  onFileSelect,
  acceptedTypes = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/x-matroska"],
  maxSizeMB = 500,
  disabled = false,
  className = "",
  children,
}: DropZoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): string | null => {
    if (!acceptedTypes.includes(file.type)) {
      return `Format non supporté. Types acceptés : ${acceptedTypes.map(t => t.split("/")[1].toUpperCase()).join(", ")}`;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      return `Fichier trop volumineux (max ${maxSizeMB}MB)`;
    }
    return null;
  }, [acceptedTypes, maxSizeMB]);

  const handleFileSelect = useCallback((file: File) => {
    const error = validateFile(file);
    if (error) {
      alert(error);
      return;
    }
    onFileSelect(file);
  }, [onFileSelect, validateFile]);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(false);
    setDragDepth(0);

    if (disabled) return;

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [disabled, handleFileSelect]);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setIsDragActive(true);
  }, [disabled]);

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setDragDepth(prev => prev + 1);
    setIsDragActive(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setDragDepth(prev => prev - 1);
    if (dragDepth <= 1) {
      setIsDragActive(false);
    }
  }, [disabled, dragDepth]);

  const handleClick = useCallback(() => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  }, [disabled]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
    e.target.value = "";
  }, [handleFileSelect]);

  return (
    <div
      ref={(el) => {
        if (el) {
          el.addEventListener("drop", handleDrop as unknown as EventListener);
          el.addEventListener("dragover", handleDragOver as unknown as EventListener);
          el.addEventListener("dragenter", handleDragEnter as unknown as EventListener);
          el.addEventListener("dragleave", handleDragLeave as unknown as EventListener);
        }
        return () => {
          if (el) {
            el.removeEventListener("drop", handleDrop as unknown as EventListener);
            el.removeEventListener("dragover", handleDragOver as unknown as EventListener);
            el.removeEventListener("dragenter", handleDragEnter as unknown as EventListener);
            el.removeEventListener("dragleave", handleDragLeave as unknown as EventListener);
          }
        };
      }}
      className={cn(
        "relative cursor-pointer transition-all duration-300",
        isDragActive && "border-cyan-500 bg-cyan-500/5 shadow-[0_0_40px_rgba(6,182,212,0.15)]",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      onClick={handleClick}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label="Zone de dépôt de vidéo"
      aria-describedby="dropzone-hint"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedTypes.join(",")}
        onChange={handleFileInputChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        disabled={disabled}
        aria-hidden="true"
      />

      {/* Animated border scan effect */}
      {isDragActive && (
        <div
          className="absolute inset-0 border-2 border-cyan-500/50 rounded-2xl animate-scan pointer-events-none"
          aria-hidden="true"
        />
      )}

      <Card
        variant={isDragActive ? "elevated" : "outlined"}
        padding="lg"
        className="relative z-10 h-full"
      >
        {children || (
          <div className="flex flex-col items-center justify-center gap-6 text-center min-h-[300px]">
            {/* Upload Icon with float animation */}
            <div className="relative animate-float">
              <svg
                className={cn(
                  "w-16 h-16 transition-colors duration-300",
                  isDragActive ? "text-cyan-400" : "text-zinc-500"
                )}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>

              {/* Pulse rings when dragging */}
              {isDragActive && (
                <>
                  <span className="absolute inset-0 border-2 border-cyan-500/30 rounded-full animate-[pulse-ring_2s_ease-out_infinite]" />
                  <span className="absolute inset-0 border-2 border-cyan-500/20 rounded-full animate-[pulse-ring_2s_ease-out_infinite]" style={{ animationDelay: "0.5s" }} />
                </>
              )}
            </div>

            <div className="space-y-2">
              <h3 className={cn(
                "text-2xl font-semibold tracking-tight",
                isDragActive ? "text-cyan-300" : "text-white"
              )}>
                Déposez votre vidéo ici
              </h3>
              <p className="text-zinc-400 max-w-md">
                Ou cliquez pour sélectionner un fichier
                <span className="text-zinc-500 ml-1">(MP4, WebM, MOV, AVI, MKV — max {maxSizeMB}MB)</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
              <Button variant="primary" size="lg" disabled={disabled}>
                Choisir un fichier
              </Button>
              <Badge variant="info" size="sm">
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Formats supportés
              </Badge>
            </div>

            {/* File types badges */}
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-zinc-500">
              {acceptedTypes.map((type) => (
                <Badge key={type} variant="default" size="sm">
                  .{type.split("/")[1].toUpperCase()}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Card>

      <span id="dropzone-hint" className="sr-only">
        Zone de dépôt pour fichier vidéo. Glissez-déposez ou cliquez pour sélectionner.
      </span>
    </div>
  );
}