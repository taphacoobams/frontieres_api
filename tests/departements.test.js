const request = require('supertest');
const app = require('../src/server');

describe('GET /api/departements', () => {
  it('should return 46 GeoJSON Features', async () => {
    const res = await request(app).get('/api/departements');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(46);
  });

  it('each departement should have valid GeoJSON Feature structure', async () => {
    const res = await request(app).get('/api/departements');
    for (const feature of res.body) {
      expect(feature.type).toBe('Feature');
      expect(feature.properties).toHaveProperty('id');
      expect(feature.properties).toHaveProperty('departement_id');
      expect(feature.properties).toHaveProperty('name');
      expect(feature.geometry).toHaveProperty('type', 'MultiPolygon');
      expect(feature.geometry).toHaveProperty('coordinates');
    }
  });

  it('should filter by region_id', async () => {
    const res = await request(app).get('/api/departements?region_id=1');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const feature of res.body) {
      expect(feature.properties.region_id).toBe(1);
    }
  });
});

describe('GET /api/departements/:id', () => {
  it('should return a single departement', async () => {
    const res = await request(app).get('/api/departements/1');
    expect(res.statusCode).toBe(200);
    expect(res.body.type).toBe('Feature');
  });

  it('should return 404 for non-existent departement', async () => {
    const res = await request(app).get('/api/departements/9999');
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/map/departements', () => {
  it('should return a FeatureCollection with 46 features', async () => {
    const res = await request(app).get('/api/map/departements');
    expect(res.statusCode).toBe(200);
    expect(res.body.type).toBe('FeatureCollection');
    expect(res.body.features.length).toBe(46);
  });
});
