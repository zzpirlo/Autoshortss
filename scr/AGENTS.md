# AutoShorts AI Pipeline - Agent Instructions

Ce fichier sert de mémoire persistante et de feuille de route pour le développement de l'application AutoShorts dans GitHub Codespaces.

## 🛠️ Stack Technique & Architecture
* **Frontend/Backend** : Next.js (App Router), TypeScript, Tailwind CSS (Style Dark/Tech).
* **Base de données** : SQLite locale via Prisma ORM.
* **Moteur Multimédia** : FFmpeg (extraction audio MP3 et recadrage vertical 9:16 en 1080x1920).
* **Intelligence Artificielle** :
  * **Deepgram (SDK v5.5)** : Transcription audio ultra-rapide avec timestamps mot par mot.
  * **DeepSeek API** : Analyse sémantique et notation de la viralité pour extraire les 3 meilleurs clips.

## 🎯 Fonctionnalités Backend Validées
1. **Traitement Asynchrone** : L'API d'upload (`/api/projects/upload`) enregistre le fichier sur disque et répond immédiatement `200 OK` pour libérer le client. Le traitement lourd s'exécute en arrière-plan.
2. **Reprise Automatique (Orphelins)** : Injection via `src/instrumentation.ts`. Au démarrage du serveur Next.js, le système détecte et relance automatiquement les projets bloqués aux états `PENDING` ou `PROCESSING`.
3. **Robustesse de l'environnement** : Nettoyage automatique des caractères spéciaux (Sanitizing) des fichiers vidéo pour éviter les crashs de la console Linux/FFmpeg.

## 🚀 Prochaine Tâche Prioritaire : Refonte Intégrale de l'UX (Mode Wizard)

Tu dois modifier radicalement l'expérience utilisateur dans le composant global `src/components/PipelinePage.tsx` pour implémenter une cinématique exclusive à 3 phases distinctes (sans résidus visuels des étapes précédentes) :

### 1. PHASE 1 - UPLOAD UNIQUEMENT
* **Condition** : Tant qu'aucun fichier n'est téléversé (absence de `projectId`).
* **UI** : Affiche **uniquement** la zone de largage (`DropZone.tsx`). Le reste de la page doit être totalement invisible.

### 2. PHASE 2 - ÉVOLUTION DU PIPELINE (Polling actif)
* **Condition** : Dès que l'upload réussit et que le statut passe à `PENDING` ou `PROCESSING`.
* **UI** : Efface **complètement** la `DropZone` de l'écran. Affiche au centre le composant `VerticalStepper` animé qui pulse en temps réel au rythme des phases remontées par l'API de polling (`GET /api/projects/[id]`) :
  * `Etape 1` : Upload & Métadonnées (Terminé ✔️)
  * `Etape 2` : Extraction Audio FFmpeg
  * `Etape 3` : Transcription Texte Deepgram
  * `Etape 4` : Analyse Virale DeepSeek

### 3. PHASE 3 - RÉSULTATS FINAUX & DÉCOUPE
* **Condition** : Dès que le statut du projet passe à `COMPLETED`.
* **UI** : Masque **complètement** le stepper de chargement. Fais place entière au tableau de bord final affichant la grille des 3 clips viraux détectés. 
* **Actions attendues** : Assurer la connexion des boutons clients avec les routes de découpe de FFmpeg :
  * **Prévisualiser** : Ouvre une modal avec le lecteur vidéo exploitant le flux fragmenté à l'adresse `/api/video/preview`.
  * **Exporter** : Déclenche l'encodage vertical physique et lance le téléchargement automatique du fichier MP4 final.

## 📋 Directives de Code (System Skills)
* **[FFmpeg Streamer]** : Ne charge jamais les fichiers vidéo entièrement en mémoire vive (RAM). Utilise impérativement les flux (`fs.createReadStream`) branchés sur FFmpeg.
* **[UI Atomic]** : Écris des composants React modulaires, réutilisables, et utilise strictement les classes Tailwind CSS du thème Dark/Tech (accents néon cyan/violet, effets de lueur *glow*).
