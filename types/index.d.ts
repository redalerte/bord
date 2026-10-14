/** État d'un sous-agent, dans les quatre mots du tableau de bord. */
export type Etat = 'attente' | 'cours' | 'termine' | 'echoue'

/** Une ligne du bloc « sous-agents ». `depuis` : début de l'état actuel, en ms. */
export type LigneAgent = {
  id: string
  nom: string
  type: string
  etat: Etat
  depuis: number
}

/** Le bloc « contexte » : remplissage de la fenêtre du modèle. */
export type Contexte = {
  fenetre: number
  tokens?: number
  pourcent?: number
}

/** Une fenêtre de limite d'utilisation (5 heures, semaine, plafond). */
export type Limite = {
  kind: string
  pourcent: number
  /** Heure de remise à zéro, ISO 8601. */
  finit?: string
}

/** Tout ce que le panneau dessine, mesuré au même instant (`instant`, en ms). */
export type Tableau = {
  instant: number
  agents: LigneAgent[]
  contexte: Contexte | null
  limites: Limite[]
}

declare module 'claude-code' {
  interface PluginState {
    bord: { tableau: Tableau }
  }
}
