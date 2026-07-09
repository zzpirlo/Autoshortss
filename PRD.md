# Product Requirement Document (PRD) - AutoShorts AI Pipeline

## 1. Vision du Produit & Objectifs
**AutoShorts** est une application web locale (SaaS-ready) conçue pour automatiser la création de clips vidéo verticaux (Shorts, TikTok, Reels) à partir de vidéos sources longues. L'application ingère un contenu brut, en extrait la substantifique moelle grâce à l'intelligence artificielle, applique un recadrage physique au format 9:16 et incruste des sous-titres dynamiques hautement stylisés.

### Objectifs Clés :
* **Expérience utilisateur (UX) fluide** : Approche "Wizard" étape par étape sans distraction visuelle.
* **Performance et scalabilité** : Traitement multimédia lourd en arrière-plan sans saturation de la mémoire vive (RAM) du serveur.
* **Automatisation intelligente** : Scoring de la viralité basé sur une analyse sémantique avancée (IA).

---

## 2. Architecture Technique Validée
* **Framework principal** : Next.js (App Router) avec TypeScript strict.
* **Persistance des données** : Base de données SQLite locale, orchestrée via Prisma ORM.
* **Gestion du traitement multimédia** : Moteur FFmpeg natif (via streams Node.js).
* **Moteur d'Intelligence Artificielle** :
  * **Deepgram (SDK v5.5)** : Transcription audio ultra-rapide avec timestamps mot par mot.
  * **DeepSeek API** : Analyse contextuelle, découpe sémantique et notation de la viralité (scoring sur 100).
* **Typographie & Rendu Visuel** : Librairie `libass` embarquée avec la police open-source **Anton** (licence OFL) pour assurer la portabilité absolue du style graphique.

---

## 3. Fonctionnalités Clés & Parcours Utilisateur (Mode Wizard)

L'expérience utilisateur est orchestrée au sein d'un composant maître (`PipelinePage.tsx`) gérant un rendu conditionnel strict divisé en trois phases exclusives :

### 🚀 Phase 1 : Collecte du Médias Source (Upload)
* **Interface** : Écran divisé en deux sections symétriques avec un thème Dark/Tech (accents néon cyan `#06b6d4`, effets *glow*).
  * **Gauche** : Zone de glisser-déposer (`DropZone.tsx`) pour charger un fichier local (MP4/MOV).
  * **Milieu** : Séparateur visuel néon "OU".
  * **Droite** : Champ de saisie d'URL YouTube (Feature Premium) équipé d'une sécurité backend limitant l'import aux vidéos de moins de 20 minutes (via `@distube/ytdl-core`).
* **Comportement Backend** : Dès la soumission, l'API d'upload écrit le flux vidéo directement sur disque (`data/uploads/`) et répond instantanément un code `200 OK` avec un `projectId`. Le client est libéré immédiatement.

### ⚙️ Phase 2 : Pipeline de Traitement Asynchrone (Polling)
* **Interface** : La zone d'upload est entièrement démontée du DOM. Un composant `VerticalStepper` centralisé s'affiche et s'anime en temps réel au rythme des phases remontées par un mécanisme de polling actif (`GET /api/projects/[id]`) toutes les 2 secondes.
* **Étapes du Pipeline de traitement** :
  1. **Upload & Métadonnées** : Validation du fichier physique.
  2. **Extraction Audio FFmpeg** : Conversion ultra-rapide de la piste vidéo en fichier audio MP3 léger.
  3. **Transcription Deepgram** : Envoi de l'audio par buffers pour obtenir une transcription textuelle minutée mot par mot.
  4. **Analyse Virale DeepSeek** : Évaluation du texte par l'IA pour extraire les trois meilleurs moments (détection des hooks, calcul des scores et génération des titres).

### 🎬 Phase 3 : Tableau de bord & Post-Production
* **Interface** : Le stepper s'efface totalement au profit d'une grille responsive (`grid-cols-1 md:2 xl:3`) affichant les 3 clips viraux sous forme de `ClipCard`. Chaque carte présente le score de viralité, le hook détecté et l'explication de l'IA.
* **Actions Disponibles** :
  * **Prévisualiser** : Ouvre une modale de lecture exploitant le flux vidéo fragmenté en continu à l'adresse `/api/video/preview`.
  * **Exporter** : Déclenche l'encodage physique final. 

---

## 4. Spécifications de Post-Production (Moteur de rendu)

L'exportation d'un clip déclenche un sous-système de rendu automatisé très strict :
1. **Recadrage Temporel & Spatial** : FFmpeg extrait le segment exact (`startTime` et `endTime`) et applique un recadrage au format vertical **9:16 (1080x1920)** à 25 fps avec l'option `faststart`.
2. **Génération de Sous-titres "CapCut Style"** :
   * Les mots fournis par Deepgram pour le segment sont isolés et regroupés de manière ultra-dynamique (1 à 3 mots maximum par ligne).
   * Un fichier temporaire au format `.ass` (Advanced SubStation Alpha) est créé dans `data/uploads/`.
   * **Style Visuel Gravé** : Police *Anton*, taille massive, texte centré à l'écran, couleur blanche par défaut (`&H00FFFFFF`), s'allumant en jaune vif (`&H0000FFFF`) au mot-à-mot via des balises de karaoké synchronisées (`\k`), le tout ceinturé par une bordure noire épaisse (`outline 5`).
3. **Nettoyage Automatique** : Le fichier `.ass` est immédiatement supprimé du disque par un bloc de nettoyage asynchrone (`fs.unlink`) dès la fin de l'encodage FFmpeg (que l'opération soit un succès ou un échec).

---

## 5. Robustesse et Tolérance aux Pannes (*System Skills*)
* **[FFmpeg Streamer]** : Interdiction absolue de charger des fichiers vidéo entiers en mémoire vive (RAM). Utilisation obligatoire des streams de lecture/écriture Node.js (`fs.createReadStream`) connectés aux pipelines de FFmpeg.
* **[Fault Tolerance]** : Chaque étape du pipeline est encapsulée dans des blocs `try/catch` isolés. En cas de défaillance réseau ou d'API, le projet passe au statut `FAILED` en base de données de manière propre, et l'interface affiche un écran d'erreur dédié offrant l'action "Réessayer".
* **[Orphan Rescuer]** : Injection via `src/instrumentation.ts`. À chaque démarrage ou redémarrage du serveur Next.js, le système balaie la base de données pour identifier les projets bloqués aux états `PENDING` ou `PROCESSING` (projets orphelins) afin de les traiter ou de les nettoyer de manière transparente.
