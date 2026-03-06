const request = require('supertest');
const app = require('../src/server');

describe('GET /api/communes', () => {
  it('should return 552 GeoJSON Features', async () => {
    const res = await request(app).get('/api/communes');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(552);
  });

  it('each commune should have valid GeoJSON Feature structure', async () => {
    const res = await request(app).get('/api/communes');
    const sample = res.body.slice(0, 10);
    for (const feature of sample) {
      expect(feature.type).toBe('Feature');
      expect(feature.properties).toHaveProperty('id');
      expect(feature.properties).toHaveProperty('commune_id');
      expect(feature.properties).toHaveProperty('departement_id');
      expect(feature.properties).toHaveProperty('name');
      expect(feature.geometry).toHaveProperty('type', 'MultiPolygon');
      expect(feature.geometry).toHaveProperty('coordinates');
    }
  });

  it('should filter by departement_id', async () => {
    const res = await request(app).get('/api/communes?departement_id=7');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const feature of res.body) {
      expect(feature.properties.departement_id).toBe(7);
    }
  });
});

describe('GET /api/communes/:id', () => {
  it('should return a single commune', async () => {
    const res = await request(app).get('/api/communes/1');
    expect(res.statusCode).toBe(200);
    expect(res.body.type).toBe('Feature');
  });

  it('should return 404 for non-existent commune', async () => {
    const res = await request(app).get('/api/communes/9999');
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/map/communes', () => {
  it('should return a FeatureCollection with 552 features', async () => {
    const res = await request(app).get('/api/map/communes');
    expect(res.statusCode).toBe(200);
    expect(res.body.type).toBe('FeatureCollection');
    expect(res.body.features.length).toBe(552);
  });
});
