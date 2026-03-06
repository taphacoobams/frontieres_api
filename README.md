# Frontières API – Sénégal 🇸🇳

API REST construite avec **Node.js (Express)** et **PostgreSQL/PostGIS** fournissant les **frontières administratives** du Sénégal : **régions, départements, communes** (polygones GeoJSON) et **25 515 localités** géolocalisées.

---

## 🚀 Fonctionnalités

* 📍 Liste des **14 régions** avec polygones GeoJSON
* 🏘️ Liste des **46 départements** avec polygones et filtrage par région
* 🏠 Liste des **552 communes** avec polygones et filtrage par département
* 📌 Liste des **25 515 localités** géolocalisées (quartiers, villages, hameaux)
* 🗺️ **FeatureCollections** GeoJSON pour cartographie (Leaflet, Mapbox, OpenLayers)
* 🔍 Recherche de localités par nom (`/api/localites/search?q=`)
* 📊 Statistiques globales (nombre de régions, départements, communes et localités)
* 📄 Pagination sur les localités (`limit`, `offset`)
* 🌐 CORS activé
* 🛡️ Sécurité (Helmet, rate limiting)
* 📦 Réponses JSON et GeoJSON
* 📖 Documentation interactive (Redoc + OpenAPI)
* 🧪 31 tests fonctionnels (Jest + Supertest)

---

## 🛠️ Stack technique

* **Node.js** >= 18
* **Express.js** — framework HTTP
* **PostgreSQL** + **PostGIS** — base de données spatiale
* **pg** — client PostgreSQL
* **senegal.ts** — référentiel administratif officiel (25 515 localités)
* **Jest** + **Supertest** — tests fonctionnels
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

Puis créer la base de données PostgreSQL :

```sql
CREATE DATABASE frontieres_db;
\c frontieres_db
CREATE EXTENSION IF NOT EXISTS postgis;
```

---

## ▶️ Lancer le projet

```bash
npm run dev      # développement (nodemon)
npm start        # production
```

L'API sera disponible sur :
👉 `http://localhost:3005`

---

## 🏗️ Initialisation de la base

```bash
npm run init-db
```

Crée les tables `regions_boundaries`, `departements_boundaries`, `communes_boundaries`, `localites_geo` avec leurs index spatiaux GIST.

---

## 📍 Pipeline des localités

Le fichier `senegal.ts` contient les **25 515 localités** avec leur hiérarchie region → departement → commune → localite.

```bash
npm run rebuild-localites
```

Le script effectue automatiquement 5 étapes :

1. **Parse `senegal.ts`** → insertion des 25 515 localités (coords NULL)
2. **SN.txt (GeoNames)** → géocodage par nom → source `sn_txt`
3. **localites.geojson (avec name)** → géocodage des restantes → source `osm_geojson`
4. **localites.geojson (sans name)** → estimation par commune (ST_Contains) → source `osm_geojson_estimated`
5. **Fallback centroïde** de la commune → source `centroide_commune`

**Résultat** : 25 515 localités, toutes avec coordonnées et commune.

| Source | Localités | Description |
|--------|-----------|-------------|
| `sn_txt` | 3 413 | Coordonnées trouvées dans SN.txt (GeoNames) |
| `osm_geojson` | 1 955 | Coordonnées trouvées dans localites.geojson (par nom) |
| `osm_geojson_estimated` | 4 857 | Points GeoJSON sans nom, assignés par commune |
| `centroide_commune` | 15 290 | Centroïde du polygone de la commune |
| **Total** | **25 515** | |

---

## 📚 Endpoints

### 🔹 Régions

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/regions` | Liste des 14 régions (GeoJSON Features) |
| `GET` | `/api/regions/:id` | Une région par ID |

### 🔹 Départements

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/departements` | Liste de tous les départements |
| `GET` | `/api/departements?region_id=X` | Départements filtrés par région |
| `GET` | `/api/departements/:id` | Un département par ID |

### 🔹 Communes

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/communes` | Liste de toutes les communes |
| `GET` | `/api/communes?departement_id=X` | Communes filtrées par département |
| `GET` | `/api/communes/:id` | Une commune par ID |

### 🔹 Localités

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/localites` | Liste de toutes les localités |
| `GET` | `/api/localites?commune_id=X` | Localités filtrées par commune |
| `GET` | `/api/localites?departement_id=X` | Localités filtrées par département |
| `GET` | `/api/localites?region_id=X` | Localités filtrées par région |
| `GET` | `/api/localites?limit=50&offset=0` | Localités paginées |
| `GET` | `/api/localites/:id` | Une localité par ID |
| `GET` | `/api/localites/search?q=dakar` | Recherche par nom (min 2 caractères) |

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

## 🧪 Tests

```bash
npm test
```

**31 tests** répartis en 5 suites :

| Suite | Tests | Vérifie |
|-------|-------|---------|
| `health.test.js` | 2 | `/health`, `/api/stats` |
| `regions.test.js` | 4 | CRUD régions, structure GeoJSON, FeatureCollection |
| `departements.test.js` | 4 | CRUD départements, filtre `region_id`, FeatureCollection |
| `communes.test.js` | 4 | CRUD communes, filtre `departement_id`, FeatureCollection |
| `localites.test.js` | 17 | CRUD localités, recherche, filtres, pagination, coordonnées valides |

---

## 🌍 Déploiement (Render)

### Variables d'environnement requises :

| Clé | Valeur |
|-----|--------|
| `NODE_ENV` | production |
| `DATABASE_URL` | Connection string PostgreSQL |

### Blueprint (automatique)

Le fichier `render.yaml` est inclus. Sur [render.com/blueprints](https://dashboard.render.com/blueprints) → **New Blueprint Instance** → connecter le repo.

### Commandes Render

**Build command**

```bash
npm install && npm run init-db
```

**Start command**

```bash
node src/server.js
```

### Importer les données

```bash
# Export depuis votre base locale
pg_dump -Fc -d frontieres_db -t regions_boundaries -t departements_boundaries -t communes_boundaries -t localites_geo > dump.sql

# Import sur Render (utiliser l'External Database URL)
pg_restore -d "postgres://user:pass@host/dbname" --no-owner --no-acl dump.sql
```

---

## 🏗️ Architecture du projet

```
frontieres_api/
├── .env                    # Variables d'environnement (non versionné)
├── .gitignore
├── package.json
├── render.yaml             # Blueprint Render
├── senegal.ts              # Référentiel administratif (25 515 localités)
├── README.md
├── tests/                  # Tests fonctionnels
│   ├── health.test.js
│   ├── regions.test.js
│   ├── departements.test.js
│   ├── communes.test.js
│   └── localites.test.js
└── src/
    ├── server.js           # Point d'entrée Express
    ├── swagger.json        # Spec OpenAPI 3.0
    ├── database/
    │   ├── connection.js   # Pool PostgreSQL (pg)
    │   └── init.js         # Création tables + index PostGIS
    ├── models/
    │   ├── regionBoundary.js
    │   ├── departementBoundary.js
    │   ├── communeBoundary.js
    │   └── localiteGeo.js
    ├── services/
    │   ├── regionService.js       # Logique métier + cache mémoire
    │   ├── departementService.js
    │   ├── communeService.js
    │   └── localiteService.js
    ├── controllers/
    │   ├── regionController.js    # Handlers HTTP
    │   ├── departementController.js
    │   ├── communeController.js
    │   └── localiteController.js
    ├── routes/
    │   ├── index.js               # Agrégation des routes
    │   ├── regionRoutes.js
    │   ├── departementRoutes.js
    │   ├── communeRoutes.js
    │   ├── localiteRoutes.js
    │   └── mapRoutes.js
    └── scripts/
        └── rebuild-localites.js   # Pipeline complet (5 étapes)
```

---

## 📊 Sources de données

| Source | Utilisation |
|--------|------------|
| [geoBoundaries (SEN)](https://www.geoboundaries.org/) | Régions (ADM1) et départements (ADM2) |
| [OpenStreetMap](https://www.openstreetmap.org/) | Communes (admin_level=8) et localités via Overpass API |
| [GeoNames (SN.txt)](https://download.geonames.org/export/dump/) | Localités (populated places) |
| Référentiel officiel | Noms et hiérarchie (`senegal.ts`) |

---

## 🤝 Contribuer

Les contributions sont les bienvenues !

1. Fork & Clone le repo
2. Créer une branche : `git checkout -b feat/ma-fonctionnalite`
3. Faire les modifications et ajouter des tests
4. Vérifier que les tests passent : `npm test`
5. Ouvrir une Pull Request

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
