# CLAUDE.md — Petite Fête

> Fichier de contexte pour Claude Code. À placer à la racine du dépôt `sxbconsulting/petite-fete`.
> Claude Code le lit automatiquement à chaque session.

---

## 1. Le produit en une phrase

**Petite Fête** est un appareil photo jetable partagé pour les fêtes et après-midi en famille : l'organisateur crée un album, partage un code `FETE-XXXX`, chaque invité prend quelques photos depuis son téléphone (sans rien installer), et tout le monde retrouve l'album complet au même endroit.

**Le vrai bénéfice** n'est pas la centralisation, c'est la présence : personne n'a besoin d'être le photographe officiel ni de passer l'après-midi derrière son écran. La limite de poses par invité (façon pellicule) sert ce message.

**Origine :** Billal et sa femme galéraient systématiquement à récupérer les photos des après-midi avec leurs amis et leurs enfants.

- En ligne : https://sxbconsulting.github.io/petite-fete/
- Dépôt : `sxbconsulting/petite-fete` (public, GitHub Pages sur `main`, racine)
- Version actuelle : lire `APP_VERSION` dans `index.html` (2.7 au moment de l'écriture)

---

## 2. Qui je suis et comment travailler avec moi

- Je suis **Billal**, formateur/consultant e-commerce. **Je ne suis pas développeur** : je fais du vibe coding.
- **Réponds en français, tutoie-moi.** Ton pragmatique, sans remplissage.
- Explique chaque décision technique en une phrase, avec une analogie business si utile.
- **Dis-moi franchement** quand une demande alourdit le produit avant validation, ou quand je m'égare.
- Je teste sur **iPhone (Safari)**. Je travaille sur MacBook Pro, macOS, Zsh.
- **N'ajoute pas de fonctionnalités que je n'ai pas demandées.** Propose-les en une ligne à la fin.

---

## 3. Contraintes de stack — NON NÉGOCIABLES

- **Un seul fichier `index.html`** : HTML + CSS + JavaScript vanilla.
- **Aucun framework** (React, Vue…), **aucun build**, **aucun npm dans l'app**.
- Bibliothèques **uniquement par CDN** (actuellement : `@supabase/supabase-js@2` via jsdelivr, Google Fonts).
- Je dois pouvoir modifier et redéployer seul. Une stack que je ne peux pas maintenir est une stack morte.
- npm/node sont autorisés **pour tes outils de test** (puppeteer, acorn…), jamais dans l'app livrée.

---

## 4. Architecture de `index.html`

Fichier d'environ 118 Ko, ~2 600 lignes. Ordre :

1. **Commentaire HTML en tête** : SQL de migration (v1 + v2). À garder à jour à chaque changement de schéma.
2. **`<style>`** : tokens de design, ciels par vue, composants.
3. **Vues** : `#view-intro` (3 volets, premier lancement), `#view-home` (créer / rejoindre / mes albums), `#view-camera`, `#view-gallery`, `#view-settings`, barre `#tabbar`.
4. **Overlays** : `#preview` (après capture), `#lightbox` (plein écran + swipe), `#howto` (mode d'emploi 2 slides).
5. **`<script>` unique**, dans une IIFE, dans cet ordre :
   - Langue (i18n) — voir §7
   - Diagnostic (erreurs JS affichées en toast)
   - CONFIG : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_VERSION`
   - État, stockage local, sessions multiples
   - Traitement média (compression, recadrage, vidéo), upload Storage
   - Rendu (`render()`), navigation (`goHome`, `goTab`), actions, `boot()`

### Fonctions clés
| Fonction | Rôle |
|---|---|
| `boot()` | Démarrage : restaure la session, intro si premier lancement |
| `render()` | Redessine caméra, galerie, réglages à partir de `state` |
| `enterEvent(ev, me, isHost)` | Entre dans un album (ferme le canal Realtime précédent) |
| `switchTo(id)` | Bascule vers un autre album déjà rejoint |
| `goHome()` / `goTab(tab)` | Navigation entre vues |
| `processPhoto` / `processVideo` | Compression, recadrage au format choisi, miniature |
| `sendMedia(media, name)` | Upload Storage + ligne en base |
| `subscribe()` | Realtime sur `once_photos` filtré par `event_id` |
| `explainError(err)` | Traduit une erreur Supabase en cause lisible |

### Design (identique à « Petite Routine »)
- Polices : **Fredoka** (UI) + **Nunito** (libellés en majuscules)
- Tokens : encre `#3a2e52`, encre douce `#7a6f96`, or `#ffb830`, menthe `#4ecb8f`, cartes blanches, radius 28px
- Animations à rebond `cubic-bezier(.34,1.56,.64,1)`, respect de `prefers-reduced-motion`
- Mobile-first, max 460px centré
- Ciels par vue : accueil rose/pêche/bleu, appareil doré, galerie bleu/vert, révélation violet nuit

---

## 5. Backend Supabase

- **Projet :** `petite-fete`, ref `yiuloyqlrvbptvgkuizl`, région eu-west-1 (Irlande), plan gratuit
- **Organisation :** « bsout93@gmail.com's Org » — contient aussi `petite-routine-lana`. **Limite gratuite : 2 projets actifs** → pas de troisième ici.
- **Clé anon** : dans `index.html` (format JWT, onglet *Legacy* du dashboard). Elle est publique par nature, c'est normal.
- ⚠️ **Ne jamais utiliser la clé `service_role`** ni les clés `sb_secret_…` dans le code. Ne jamais cliquer « Disable JWT-based API keys » : supabase-js en CDN utilise la clé JWT.

### Tables
**`once_events`** : `id`, `code` (unique, `FETE-XXXX`, alphabet sans I/L/O/1), `event_name`, `event_type` (birthday/school/party/holiday/other), `child_name`, `host_name`, `reveal_mode` (immediate/scheduled), `reveal_at`, `is_closed`, `photo_limit` (null = illimité), `created_at`

**`once_photos`** : `id`, `event_id` (cascade), `media_type` (photo/video), `storage_path`, `media_url`, `thumb_data` (miniature base64 ~420px), `width`, `height`, `duration_s`, `taken_by`, `taken_at`, `emoji_reaction`, `photo_data` (**legacy v1** base64, à garder pour les anciennes photos)

### Storage
Bucket public **`fete-media`**, 100 Mo max par fichier, chemins `<event_id>/<uuid>.jpg|mp4|mov`.

### Sécurité
RLS **permissive** (`allow all`) sur les deux tables et le bucket. Le code `FETE-XXXX` est le seul contrôle d'accès. Acceptable pour un test entre proches, **pas pour un lancement public** : à durcir avant toute ouverture.

### Realtime
Publication `supabase_realtime` contient `once_photos`. (Dans le dashboard : Database → **Publications**, pas « Replication ».)

### Règle
**Avant toute modification de schéma : montre-moi le SQL et attends mon accord.** Puis ajoute-le au commentaire de migration en tête de `index.html`.

---

## 6. Anti-pause (GitHub Actions)

Le plan gratuit met le projet en pause après 7 jours sans requête. Le workflow `.github/workflows/keep-alive.yml` pinge l'API REST **lundi, mercredi, vendredi à 6h UTC**.

- Secrets requis : `SUPABASE_URL`, `SUPABASE_ANON_KEY` (Settings → Secrets and variables → Actions)
- Le script nettoie les espaces/retours à la ligne des secrets et vérifie le DNS avant d'appeler
- Un projet **déjà en pause** ne se réveille pas par un ping : il faut cliquer **Restore project** dans le dashboard
- GitHub désactive les workflows planifiés après 60 jours sans commit

---

## 7. Internationalisation (FR / EN)

- Langue stockée dans `localStorage.once_lang` (`fr` par défaut). Sélecteur 🇫🇷 / 🇺🇸 dans les réglages ; changer de langue **recharge la page** et rouvre les réglages.
- **Dictionnaire `EN`** : les **clés sont les textes français**, les valeurs la traduction anglaise.
- **`t('texte FR', {n: 3})`** : renvoie le texte dans la langue active, remplace les `{variables}`. Les espaces de début/fin sont conservés.
- **`pw(n, 'pose', 'poses')`** : mot au singulier/pluriel traduit (FR : 0 et 1 au singulier ; EN : seul 1 au singulier). **`plural(n, …)`** = nombre + `pw`.
- **`translateDOM()`** traduit au chargement les textes fixes du HTML, les `placeholder`, `aria-label` et `alt`. Un `MutationObserver` traduit aussi le HTML injecté plus tard.

### Règle pour tout nouveau texte
1. Dans le HTML : écris-le en français **et ajoute la clé dans `EN`**.
2. Dans le JS : **toujours `t('…')`**, jamais une chaîne française brute. Pour une phrase avec variables, un gabarit : `t('Il te reste {n} {w}.', {n, w: pw(n,'pose','poses')})`. **Ne jamais concaténer des morceaux de phrase.**
3. Ne mets jamais une valeur technique (ex. `'photo'` comme `media_type`) dans `EN`.

---

## 8. Stockage local (navigateur)

| Clé | Contenu |
|---|---|
| `once_current_event` | Album ouvert : `{event, me, isHost}` |
| `once_sessions` | Tous les albums rejoints (12 max) |
| `once_photos:<event_id>` | Cache des miniatures **par album** (jamais la pleine résolution) |
| `once_skip_sync` | `"1"` = mode local (bandeau d'alerte + lien « Réactiver ») |
| `once_intro_seen`, `once_howto_seen` | Intro et mode d'emploi déjà vus |
| `once_ratio`, `once_quality` | Format et qualité photo |
| `once_lang`, `once_open_settings` | Langue ; rouvrir les réglages après rechargement |

---

## 9. Pièges déjà rencontrés — ne pas les reproduire

1. **Remplacements de texte automatisés** : un rechercher-remplacer a fait s'appeler `touchSession()` elle-même (récursion infinie, `RangeError`) ; un autre a glissé une ligne dans `goHome()` au lieu de `render()`, ce qui faisait planter chaque retour à l'accueil. → **Après toute modification par script, relis la zone modifiée et lance le test de parcours.**
2. **Cache partagé entre albums** → fuite de photos d'un album à l'autre. Toujours suffixer les clés par l'ID d'entité.
3. **Canal Realtime non fermé** au changement d'album → abonnements fantômes. `enterEvent` le ferme.
4. **Mode local silencieux** : des albums créés hors synchro avaient des codes qui n'existaient que sur un téléphone. Le mode local est maintenant visible et réversible ; ne pas le rendre discret à nouveau.
5. **Photos en base64 en base** : impossible au-delà de quelques dizaines. Tout passe par Storage ; seule la miniature est en base.
6. **`<span>` sans `display:block`** dans des boutons → textes collés (« TestFETE-JNDR »).
7. **Projet Supabase en pause** = le nom d'hôte disparaît du DNS (`curl` code 6). Ce n'est pas un problème de clé.

---

## 10. Protocole de vérification — OBLIGATOIRE avant chaque livraison

1. `node --check` sur le script extrait de `index.html` (syntaxe).
2. Vérifier que chaque `$('#id')` utilisé existe dans le HTML.
3. **Test de parcours dans un navigateur sans écran** (puppeteer) en anglais puis en français : intro → création d'un album → appareil → galerie → réglages → renommage. Zéro erreur JS ; en anglais, aucun texte français résiduel.
   - Si le téléchargement de Chromium par Playwright est bloqué : `npm install @sparticuz/chromium puppeteer-core` fonctionne.
   - Bloquer le réseau pendant le test (mode local) pour qu'il soit rapide et reproductible.
4. Incrémenter **`APP_VERSION`** (affichée en bas des réglages) et décrire le changement dans le commentaire à côté.
5. Après déploiement : vérifier que la page en ligne contient la nouvelle `APP_VERSION`.

---

## 11. Déploiement

```zsh
git add index.html
git commit -m "vX.Y : <ce qui change>"
git push origin main
```
GitHub Pages redéploie en 1 à 3 minutes. Vérifie la version en ligne avant de me dire « c'est en ligne ». Sur iPhone, une ancienne version peut rester en cache : tester en navigation privée.

---

## 12. Pistes identifiées (non faites — me demander avant)

Classées par rapport valeur/effort :
1. **Lien de partage direct** `?code=FETE-XXXX` (+ QR code) : supprime la saisie du code, la friction n°1 probable
2. **Drapeau de langue sur l'accueil** : aujourd'hui un invité anglophone voit l'intro en français avant d'entrer dans un album
3. **Supprimer une photo** (la sienne ; toutes pour l'organisateur) — penser à supprimer aussi le fichier Storage
4. **Export ZIP de l'album** à la fermeture — hypothèse de monétisation la moins coûteuse à tester (~3 €). ⚠️ Paiement = Stripe, que je ne maîtrise pas encore
5. **Durcir la sécurité** (RLS par événement) avant tout lancement public

---

## 13. Validation produit — à respecter

Protocole : **5 vraies personnes de la cible**, retour **spontané sous 7 jours** sans relance. **3 sur 5 = on continue**, en dessous on arrête ou on repositionne.

Métriques pour ce produit :
- Nombre de **photographes distincts** par album (≥ 3, sinon c'est juste mon téléphone)
- Temps entre « je reçois le code » et « ma première photo est envoyée » (< 60 s)

**Ne me laisse pas construire de complexité supplémentaire** (monétisation, store, intégrations) avant que ce test soit passé.
