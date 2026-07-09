# CLAUDE.md - AutoShorts Next.js Project

## 📜 Directives de Développement (System Skills)
* **[FFmpeg Streamer]** : Ne JAMAIS charger de fichiers vidéo entiers en mémoire vive (RAM). Utilise obligativement les streams Node.js (`fs.createReadStream`) connectés aux pipes FFmpeg pour éviter de saturer le Codespace.
* **[SQLite Mutex]** : Gère les accès concurrents à la base SQLite via Prisma en sécurisant les écritures et en appliquant des timeouts adaptés.
* **[UI Atomic]** : Écris des composants React/Tailwind hautement modulaires, isolés et réutilisables. Style Dark/Tech obligatoire (fond sombre, accents néon cyan `#06b6d4`, animations pulse et rings).
* **[Fault Tolerance]** : Encapsule chaque étape du pipeline (Upload -> FFmpeg -> Deepgram -> DeepSeek) dans des blocs `try/catch` isolés. En cas d'erreur, passe le statut du projet à `FAILED` en base de données sans faire planter l'application.

## 🚀 Commandes Fréquentes du Projet

### Environnement de Développement
* Lancer le serveur Next.js : `npm run dev`
* Build de l'application : `npm run build`
* Vérification des types TypeScript : `npx tsc --noEmit`

### Base de données (Prisma & SQLite)
* Générer le client Prisma : `npx prisma generate`
* Appliquer les migrations / Synchroniser la DB : `npx prisma db push`
* Ouvrir l'interface de visualisation Prisma Studio : `npx prisma studio`

## 📐 Architecture et Fichiers Clés
* `src/components/PipelinePage.tsx` : Composant orchestrateur principal du mode Wizard (Rendu conditionnel Phases 1, 2 et 3).
* `src/app/api/projects/upload/route.ts` : Route API d'upload asynchrone (Sauvegarde la vidéo originale dans `data/uploads/`, applique le nettoyage du nom de fichier et répond immédiatement `200 OK`).
* `src/instrumentation.ts` : Point d'entrée système gérant la reprise automatique des projets orphelins (`PENDING`/`PROCESSING`) au démarrage du serveur.
* `src/lib/videoProcessor.ts` : Logique FFmpeg (Extraction audio MP3, streaming de prévisualisation avec MP4 fragmenté et recadrage physique vertical 9:16).
* `src/lib/transcriptService.ts` : Connexion au SDK Deepgram (v5.5) pour la transcription par Buffer avec type MIME `audio/mpeg`.
* `src/lib/aiAnalyzer.ts` : Connexion à l'API DeepSeek pour le scoring de viralité et l'extraction des clips.

## 🎨 Normes de Code (Code Style & Quality)
* **TypeScript** : Typage strict requis. Pas de type `any`. Les réponses d'API doivent être castées avec des interfaces claires (ex: `ViralMoment[]`).
* **Composants** : Utiliser la directive `"use client"` uniquement sur les conteneurs qui gèrent l'état (comme `PipelinePage.tsx`), garder les sous-composants atomiques aussi purs que possible.
* **FFmpeg** : Toujours écouter l'événement `request.signal.abort` pour tuer instantanément les processus FFmpeg en arrière-plan si l'utilisateur ferme sa page ou annule sa requête.
