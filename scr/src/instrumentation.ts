/**
 * Instrumentation Next.js : exécutée UNE SEULE fois au démarrage du serveur
 * (avant de servir des requêtes). On en profite pour relancer le traitement
 * des projets orphelins (PENDING/PROCESSING) laissés par un redémarrage.
 *
 * better-sqlite3 étant natif, on ne l'importe que côté Node.js.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { recoverOrphanProjects } = await import('./lib/pipeline');
    await recoverOrphanProjects();
  }
}
