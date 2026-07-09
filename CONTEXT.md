# CONTEXT.md — État du Projet & Prochaines Étapes

Ce document fait un état des lieux précis du projet **AutoShorts** à la fin de la session de développement actuelle. Il répertorie les fichiers clés, les succès techniques validés, et définit les priorités pour la suite.

---

## 📍 État Actuel du Projet
L'application a été entièrement restructurée avec succès d'une architecture monolithique empilée vers un **Mode Wizard exclusif à 3 phases distinctes**, piloté de manière asynchrone par une base SQLite locale et des agents IA (Deepgram & DeepSeek).

### 🚀 Succès Récents (100% Fonctionnels)
1. **Mode Wizard (UI/UX)** : Le composant orchestrateur gère les phases `upload` ➔ `pipeline` ➔ `results` avec démontage strict du DOM (aucun résidu visuel).
2. **Pipeline Backend E2E** : Validé avec le fichier de test de 19 minutes `ruse.mp4`. Temps de traitement total : ~15 secondes (zéro surcharge RAM).
3. **Sous-titres Style "CapCut"** : Génération de fichiers de sous-titres avancés `.ass` avec découpage dynamique (1 à 3 mots max) et effet **karaoké mot-à-mot** (mots dits en blanc, mot courant qui s'illumine en jaune vif).
4. **Portabilité Graphique** : Intégration locale de la police **Anton** (Google Fonts/OFL) dans le code de FFmpeg via l'option `fontsdir`, garantissant un rendu identique sur n'importe quel OS, sans dépendre des polices système Linux.

---

## 📂 Carte des Fichiers Clés du Projet
Pour toute modification future, voici les fichiers stratégiques à cibler :

* **Interface Utilisateur (Wizard)** : `src/components/PipelinePage.tsx`
* **Logique de Découpe & FFmpeg** : `src/lib/videoProcessor.ts`
* **Générateur de Sous-titres (.ass)** : `src/lib/subtitleGenerator.ts`
* **Reprise des Projets au Démarrage** : `src/instrumentation.ts`
* **Route API d'Upload Asynchrone** : `src/app/api/projects/upload/route.ts`
* **Route API d'Import URL (Premium)** : `src/app/api/projects/url/route.ts` *(Note : Bloquée par les restrictions anti-bot de l'IP YouTube dans Codespaces)*

---

## 🛠️ Prochaines Étapes Prioritaires (Backlog)

Si tu dois relancer un agent ou poursuivre le développement, voici les fonctionnalités suggérées par ordre de priorité :

### 1. Amélioration du Lecteur de Prévisualisation (Phase 3)
* **Objectif** : S'assurer que la modale de prévisualisation web lise parfaitement le flux vidéo fragmenté généré par la route `/api/video/preview`.
* **Amélioration** : Ajouter un cadre vertical 9:16 stylisé autour du lecteur pour simuler l'écran d'un smartphone TikTok directement dans l'interface.

### 2. Animations de Caméra Assistées par l'IA (Smart Zooms)
* **Objectif** : Rendre les clips encore plus dynamiques en simulant des mouvements de caméra automatiques.
* **Méthode** : Utiliser les moments d'excitation ou les débuts de phrases détectés par Deepgram pour appliquer un léger zoom numérique FFmpeg (ex: `scale` ou `crop` dynamique) sur certaines phrases clés pour casser la monotonie d'un plan fixe.

### 3. Gestion Multi-Langues automatique
* **Objectif** : Permettre à l'application de traiter nativement des vidéos en anglais ou en espagnol.
* **Méthode** : Utiliser la détection automatique de la langue (déjà gérée par Deepgram) pour ajuster les instructions de prompt envoyées à l'API DeepSeek, afin que les titres des clips et les descriptions générés soient toujours dans la même langue que la vidéo source.

### 4. Migration Cloud (Supabase / S3)
* **Objectif** : Sortir de l'environnement local GitHub Codespaces pour préparer un déploiement SaaS à grande échelle.
* **Méthode** : Remplacer SQLite par **Supabase (PostgreSQL)** et remplacer le stockage local par un bucket **Amazon S3** ou **Supabase Storage** pour héberger les vidéos originales et les clips exportés.
