const request = require('supertest');
const app = require('../src/server');

describe('GET /api/regions', () => {
  it('should return 14 GeoJSON Features', async () => {
    const res = await request(app).get('/api/regions');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(14);
  });

  it('each region should have valid GeoJSON Feature structure', async () => {
    const res = await request(app).get('/api/regions');
    for (const feature of res.body) {
      expect(feature.type).toBe('Feature');
      expect(feature.properties).toHaveProperty('id');
      expect(feature.properties).toHaveProperty('region_id');
      expect(feature.properties).toHaveProperty('name');
      expect(feature.geometry).toHaveProperty('type', 'MultiPolygon');
      expect(feature.geometry).toHaveProperty('coordinates');
      expect(Array.isArray(feature.geometry.coordinates)).toBe(true);
    }
  });
});

describe('GET /api/regions/:id', () => {
  it('should return a single region', async () => {
    const res = await request(app).get('/api/regions/1');
    expect(res.statusCode).toBe(200);
    expect(res.body.type).toBe('Feature');
    expect(res.body.properties).toHaveProperty('name');
  });

  it('should return 404 for non-existent region', async () => {
    const res = await request(app).get('/api/regions/9999');
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/map/regions', () => {
  it('should return a FeatureCollection with 14 features', async () => {
    const res = await request(app).get('/api/map/regions');
    expect(res.statusCode).toBe(200);
    expect(res.body.type).toBe('FeatureCollection');
    expect(Array.isArray(res.body.features)).toBe(true);
    expect(res.body.features.length).toBe(14);
  });
});
