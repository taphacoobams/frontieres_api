# Frontières API – Sénégal 🇸🇳

API REST construite avec **Node.js / Express** et **PostgreSQL / PostGIS** fournissant les frontières administratives complètes du Sénégal enrichies avec les données de population du **recensement ANSD 2023**.

---

## 🚀 Fonctionnalités

* 🇸🇳 **Sénégal (pays)** — polygone national, coordonnées, population, densité, superficie
* 📍 **14 régions** — polygones MultiPolygon, coordonnées, population, densité, superficie
* 🏘️ **46 départements** — polygones MultiPolygon, coordonnées, population, densité, superficie
* 🏠 **552 communes** — polygones MultiPolygon, coordonnées, population, densité, superficie
* 📌 **25 515 localités** — polygones Voronoï, coordonnées GPS, population (ANSD 2023), densité
* 🗺️ **FeatureCollections GeoJSON** pour Leaflet, Mapbox, OpenLayers, D3.js, SVG
* 🔍 Recherche par nom avec filtrage multi-niveaux (commune, département, région)
* 📊 Statistiques globales
* 📄 Pagination sur les localités (`limit`, `offset`)
* 🔗 Routes imbriquées (`/regions/:id/departements`, `/departements/:id/communes`, `/communes/:id/localites`)
* 🌐 CORS activé
* 🛡️ Sécurité (Helmet, rate limiting 200 req/15 min)
* 📖 Documentation interactive (Redoc + OpenAPI)
* 🧪 Tests fonctionnels

---

## 📊 Données de population

Les données de population proviennent du **Recensement Général de la Population et de l'Habitat (RGPH) 2023** de l'ANSD.

| Niveau | Couverture |
|--------|------------|
| Régions | 14 / 14 |
| Départements | 46 / 46 |
| Communes | 552 / 552 |
| Localités | 25 515 / 25 515 |

**Population totale recensée : ~22 488 341 habitants**

Les densités (`densite`, en hab/km²) sont calculées à partir de la population et de la superficie (`superficie_km2`).

---

## 🗄️ Schéma de la base

Toutes les entités partagent les mêmes colonnes de base : `id`, `name`, `lat`, `lon`, `elevation`, `geometry`, `superficie_km2`, `population`, `densite`.

```sql
-- Type géométrique uniforme
geometry(MultiPolygon, 4326)

pays          (id, name, lat, lon, elevation, geometry, superficie_km2, population, densite)
regions       (id, name, code, lat, lon, elevation, geometry, superficie_km2, population, densite)
departements  (id, name, region_id, code, lat, lon, elevation, geometry, superficie_km2, population, densite)
communes      (id, name, departement_id, region_id, lat, lon, elevation, geometry, superficie_km2, population, densite)
localites     (id, name, commune_id, departement_id, region_id, lat, lon, elevation, geometry, superficie_km2, population, densite)
```

### Index

* **GIST** sur toutes les colonnes `geometry` (5 tables)
* **B-tree** sur `region_id`, `departement_id`, `commune_id` (clés de liaison)
* **GIN trigram** sur `localites.normalized_name` (recherche floue)

---

## 🛠️ Stack technique

* **Node.js** >= 18
* **Express.js** — framework HTTP
* **PostgreSQL** + **PostGIS** — base de données spatiale
* **pg_trgm** — recherche floue pour le matching des localités
* **pg** — client PostgreSQL
* **Helmet** — sécurité HTTP
* **Jest** + **Supertest** — tests fonctionnels
* Déployée sur **Render**

---

## 📦 Installation locale

```bash
git clone https://github.com/taphacoobams/frontieres_api.git
cd frontieres_api
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

## ▶️ Démarrage

```bash
# Initialiser le schéma de la base (à faire une fois)
npm run init-db

# Ou migrer une base existante (idempotent, peut être relancé)
npm run migrate-db

# Développement (hot-reload)
npm run dev

# Production
node src/server.js
```

L'API est disponible sur `http://localhost:3005`.

---

## 🌍 Déploiement (Render)

### Variables d'environnement

| Clé | Valeur |
|-----|--------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Connection string PostgreSQL (fourni par Render) |

### Commandes Render

| Rôle | Commande |
|------|----------|
| Build | `npm install && npm run migrate-db` |
| Start | `node src/server.js` |

`npm run migrate-db` ajoute les colonnes manquantes (`ADD COLUMN IF NOT EXISTS`), crée les index GIST et B-tree. Il est **idempotent** — peut être relancé sans risque.

### Importer les données depuis une base locale

```bash
# Export (tables actuelles)
pg_dump -Fc -d frontieres_db \
  -t pays -t regions -t departements -t communes -t localites \
  > dump.sql

# Import sur Render (External Database URL)
pg_restore -d "postgres://user:pass@host/dbname" \
  --no-owner --no-acl dump.sql
```

### Importer le polygone national

```bash
npm run import-pays
```

Importe `sen_admin0_em.geojson`, calcule la superficie via PostGIS, additionne la population des localités, et calcule la densité.

---

## 📚 Endpoints

### Pays

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/pays` | Données nationales (id, name, lat, lon, elevation, population, superficie, densité) |
| `GET` | `/api/map/pays` | FeatureCollection GeoJSON du polygone national |

### Régions

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/regions` | Liste des 14 régions |
| `GET` | `/api/regions/:id` | Région par ID |
| `GET` | `/api/regions/:id/departements` | Départements d'une région |
| `GET` | `/api/map/regions` | FeatureCollection GeoJSON |

### Départements

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/departements` | Liste des 46 départements |
| `GET` | `/api/departements?region_id=1` | Filtrés par région |
| `GET` | `/api/departements/:id` | Département par ID |
| `GET` | `/api/departements/:id/communes` | Communes d'un département |
| `GET` | `/api/map/departements` | FeatureCollection GeoJSON |
| `GET` | `/api/map/departements?region_id=1` | FeatureCollection filtrée par région |

### Communes

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/communes` | Liste des 552 communes |
| `GET` | `/api/communes?departement_id=1` | Filtrées par département |
| `GET` | `/api/communes?region_id=1` | Filtrées par région |
| `GET` | `/api/communes/:id` | Commune par ID |
| `GET` | `/api/communes/:id/localites` | Localités d'une commune |
| `GET` | `/api/map/communes` | FeatureCollection GeoJSON |
| `GET` | `/api/map/communes?departement_id=1` | FeatureCollection filtrée par département |
| `GET` | `/api/map/communes?region_id=1` | FeatureCollection filtrée par région |

### Localités

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/localites` | Liste des localités (paginée) |
| `GET` | `/api/localites?commune_id=1` | Filtrées par commune |
| `GET` | `/api/localites?departement_id=1` | Filtrées par département |
| `GET` | `/api/localites?region_id=1` | Filtrées par région |
| `GET` | `/api/localites?limit=50&offset=0` | Pagination |
| `GET` | `/api/localites/:id` | Localité par ID |
| `GET` | `/api/localites/search?q=dakar` | Recherche par nom (≥ 2 caractères) |
| `GET` | `/api/map/localites` | FeatureCollection GeoJSON |
| `GET` | `/api/map/localites?commune_id=1` | FeatureCollection filtrée par commune |
| `GET` | `/api/map/localites?departement_id=1` | FeatureCollection filtrée par département |
| `GET` | `/api/map/localites?region_id=1` | FeatureCollection filtrée par région |

> La recherche est insensible à la casse et aux accents.

### Statistiques & Utilitaires

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/stats` | Compteurs globaux (régions, depts, communes, localités) |
| `GET` | `/health` | Statut serveur et base de données |
| `GET` | `/docs` | Documentation Redoc |
| `GET` | `/api/openapi.json` | Spécification OpenAPI |

---

## 📐 Format de réponse

### Endpoints `/api/map/*` — GeoJSON FeatureCollection

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "MultiPolygon", "coordinates": [...] },
      "properties": {
        "id": 1,
        "name": "Dakar",
        "lat": 14.7167,
        "lon": -17.4677,
        "elevation": 12,
        "superficie_km2": 542.6,
        "population": 4391619,
        "densite": 8107.84
      }
    }
  ]
}
```

### Endpoints `/api/*` — Objets plats

Les endpoints de données retournent des objets plats (ou tableaux d'objets) :

```json
{
  "id": 1,
  "name": "Sénégal",
  "lat": 14.4974,
  "lon": -14.4524,
  "elevation": null,
  "superficie_km2": 196629.32,
  "population": 22488341,
  "densite": 114.37
}
```

---

## 🧪 Tests

```bash
npm test
```

34 tests couvrant tous les endpoints (régions, départements, communes, localités, santé).

---

## 🤝 Contribuer

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

### 3. Tester

```bash
npm test
```

### 4. Ouvrir une Pull Request

Décris ce que tu as ajouté ou corrigé et référence l'issue si applicable.

### 5. Signaler un bug

Ouvre une [issue GitHub](https://github.com/taphacoobams/frontieres_api/issues) avec le comportement observé, attendu, et les étapes pour reproduire.

---

## 💡 Inspiration

Ce projet est inspiré par [**decoupage_administratif_api**](https://github.com/TheShvdow/decoupage_administratif_api) de [@TheShvdow](https://github.com/TheShvdow), enrichi avec les **polygones géographiques** (frontières PostGIS), les **25 515 localités** géolocalisées, et les **données de population ANSD 2023**.

---

## 📄 Licence

MIT

---

## 👨🏽‍💻 Auteur

**taphacoobams** — [github.com/taphacoobams](https://github.com/taphacoobams)

---

> Projet open-source pour faciliter l'accès aux données administratives et démographiques du Sénégal 🇸🇳
