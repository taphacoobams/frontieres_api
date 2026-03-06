# Frontières API – Sénégal 🇸🇳

API REST construite avec **Node.js (Express)** et **PostgreSQL/PostGIS** fournissant les frontières administratives complètes du Sénégal : **régions, départements, communes et localités**.

---

## 🚀 Fonctionnalités

* 📍 Liste des **14 régions** avec leurs polygones GeoJSON (MultiPolygon)
* 🏘️ Liste des **46 départements** par région (avec polygones GeoJSON)
* 🏠 Liste des **552 communes** avec polygones GeoJSON et filtrage par département
* 📌 Liste des **25 515 localités** avec coordonnées GPS et rattachement commune
* 🗺️ **FeatureCollections** GeoJSON pour cartographie (Leaflet, Mapbox, OpenLayers, D3.js)
* 🔍 Recherche par nom dans les localités (avec filtrage par commune, département, région)
* 📊 Statistiques globales (nombre de régions, départements, communes et localités)
* 📄 Pagination sur les localités (`limit`, `offset`)
* 🌐 CORS activé
* 🛡️ Sécurité (Helmet, rate limiting 200 req/15min)
* 📦 Réponses JSON et GeoJSON (Feature & FeatureCollection)
* 📖 Documentation interactive (Redoc + OpenAPI)
* 🧪 34 tests fonctionnels

---

## 🛠️ Stack technique

* **Node.js** >= 18
* **Express.js** — framework HTTP
* **PostgreSQL** + **PostGIS** — base de données spatiale
* **pg** — client PostgreSQL
* **Helmet** — sécurité HTTP
* **Jest** + **Supertest** — tests fonctionnels
* **npm** — gestionnaire de paquets
* Déployée sur **Render**

---

## 📦 Installation locale

```bash
# Cloner le projet
git clone https://github.com/taphacoobams/frontieres_api.git
cd frontieres_api

# Installer les dépendances
npm install
```

---

## ⚙️ Configuration

Créer un fichier `.env` à la racine :

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=frontieres_db
DB_USER=postgres
DB_PASSWORD=your_password
PORT=3005
NODE_ENV=development
```

---

## ▶️ Lancer le projet en développement

```bash
npm run dev
```

L'API sera disponible sur :
👉 `http://localhost:3005`

---

## 🏗️ Build & Production

```bash
npm install
npm run init-db
node src/server.js
```

---

## 🌍 Déploiement (Render)

### Variables d'environnement requises :

| Clé | Valeur |
|-----|--------|
| `NODE_ENV` | production |
| `DATABASE_URL` | Connection string PostgreSQL |

### Commandes Render

**Build command**

```bash
npm install && npm run init-db
```

**Start command**

```bash
node src/server.js
```

Le fichier `render.yaml` est inclus pour le déploiement automatique via [Render Blueprints](https://dashboard.render.com/blueprints).

### Importer les données

```bash
# Export depuis votre base locale
pg_dump -Fc -d frontieres_db -t regions_boundaries -t departements_boundaries -t communes_boundaries -t localites > dump.sql

# Import sur Render (utiliser l'External Database URL)
pg_restore -d "postgres://user:pass@host/dbname" --no-owner --no-acl dump.sql
```

---

## 📚 Endpoints

### 🔹 Régions

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/regions` | Liste des 14 régions (GeoJSON Features avec polygones) |
| `GET` | `/api/regions/:id` | Région par ID |

### 🔹 Départements

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/departements` | Liste de tous les départements |
| `GET` | `/api/departements?region_id=1` | Départements filtrés par région |
| `GET` | `/api/departements/:id` | Département par ID |

### 🔹 Communes

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/communes` | Liste de toutes les communes |
| `GET` | `/api/communes?departement_id=1` | Communes filtrées par département |
| `GET` | `/api/communes/:id` | Commune par ID |

### 🔹 Localités

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/localites` | Liste de toutes les localités |
| `GET` | `/api/localites?commune_id=1` | Localités filtrées par commune |
| `GET` | `/api/localites?departement_id=1` | Localités filtrées par département |
| `GET` | `/api/localites?region_id=1` | Localités filtrées par région |
| `GET` | `/api/localites?limit=50&offset=0` | Localités paginées |
| `GET` | `/api/localites/:id` | Localité par ID |
| `GET` | `/api/localites/search?q=dakar` | Recherche par nom (min 2 caractères) |

> La recherche est insensible à la casse.

### 🔹 Cartographie (FeatureCollections)

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/map/regions` | FeatureCollection de toutes les régions |
| `GET` | `/api/map/departements` | FeatureCollection de tous les départements |
| `GET` | `/api/map/communes` | FeatureCollection de toutes les communes |

### 🔹 Statistiques & Utilitaires

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/stats` | Nombre total de régions, départements, communes et localités |
| `GET` | `/health` | Statut du serveur (database, timestamp) |
| `GET` | `/docs` | [Documentation interactive (Redoc)](https://frontieres-api.onrender.com/docs) |
| `GET` | `/api/openapi.json` | [Spécification OpenAPI JSON](https://frontieres-api.onrender.com/api/openapi.json) |

---

## 📍 Pipeline des localités

Le fichier `senegal.ts` contient les **25 515 localités** avec leur hiérarchie :

`region → departement → commune → localite`

```bash
npm run rebuild-localites
```

Le script effectue automatiquement 7 étapes :

1. **Parse `senegal.ts`** → insertion des 25 515 localités (coords NULL)
2. **Normalisation des noms** → suppression accents, tirets, ponctuation
3. **SN.txt (GeoNames, feature_class=P)** → géocodage par nom → source `sn_txt`
4. **communes.json** → chargement des centres communes (pour filtrage étape 6)
5. **localites.geojson (avec name, place=village|hamlet|neighbourhood)** → source `osm_geojson`
6. **localites.geojson (sans name)** → estimation par commune, skip si proche centre → source `osm_geojson_estimated`
7. **Distribution spatiale** → points uniques dans le polygone commune (ST_GeneratePoints) → source `commune_polygon_random`

| Source | Localités | Description |
|--------|-----------|-------------|
| `sn_txt` | 3 367 | Coordonnées depuis SN.txt (GeoNames, populated places) |
| `osm_geojson` | 1 980 | Coordonnées depuis localites.geojson (par nom) |
| `osm_geojson_estimated` | 4 676 | Points GeoJSON sans nom, assignés par commune |
| `commune_polygon_random` | 15 492 | Points uniques générés dans le polygone commune |
| **Total** | **25 515** | |

---

## 🧪 Tests

```bash
npm test
```

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! Voici comment participer :

### 1. Fork & Clone

```bash
git clone https://github.com/<ton-username>/frontieres_api.git
cd frontieres_api
npm install
```

### 2. Créer une branche

```bash
git checkout -b feat/ma-fonctionnalite
```

### 3. Faire tes modifications

- Respecte la structure existante (Express, JavaScript)
- Ajoute des tests fonctionnels pour chaque nouveau endpoint
- Vérifie que tous les tests passent :

```bash
npm test
```

### 4. Ouvrir une Pull Request

- Décris clairement ce que tu as ajouté ou corrigé
- Référence l'issue correspondante si elle existe (ex: `Closes #12`)
- Attends la revue avant le merge

### 5. Signaler un bug ou proposer une idée

Ouvre une [issue GitHub](https://github.com/taphacoobams/frontieres_api/issues) en décrivant :
- Le comportement observé
- Le comportement attendu
- Les étapes pour reproduire

---

## 💡 Inspiration

Ce projet est inspiré par [**decoupage_administratif_api**](https://github.com/TheShvdow/decoupage_administratif_api) de [@TheShvdow](https://github.com/TheShvdow). L'idée était d'aller plus loin en ajoutant les **polygones géographiques** (frontières) de chaque entité administrative et les **25 515 localités** géolocalisées.

---

## 📄 Licence

MIT

---

## 👨🏽‍💻 Auteur

**taphacoobams**
GitHub : [https://github.com/taphacoobams](https://github.com/taphacoobams)

---

> Projet open-source visant à faciliter l'accès aux données administratives du Sénégal 🇸🇳
