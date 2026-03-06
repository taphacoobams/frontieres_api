const request = require('supertest');
const app = require('../src/server');

describe('GET /api/localites', () => {
  it('should return an array of localites', async () => {
    const res = await request(app).get('/api/localites?limit=10');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(10);
  });

  it('each localite should have valid structure', async () => {
    const res = await request(app).get('/api/localites?limit=5');
    for (const loc of res.body) {
      expect(loc).toHaveProperty('id');
      expect(loc).toHaveProperty('name');
      expect(loc).toHaveProperty('commune_id');
      expect(loc).toHaveProperty('departement_id');
      expect(loc).toHaveProperty('region_id');
      expect(loc).toHaveProperty('latitude');
      expect(loc).toHaveProperty('longitude');
      expect(loc).toHaveProperty('source');
      expect(typeof loc.latitude).toBe('number');
      expect(typeof loc.longitude).toBe('number');
      expect(loc.latitude).toBeGreaterThanOrEqual(12);
      expect(loc.latitude).toBeLessThanOrEqual(17);
      expect(loc.longitude).toBeGreaterThanOrEqual(-18);
      expect(loc.longitude).toBeLessThanOrEqual(-11);
    }
  });

  it('should filter by commune_id', async () => {
    const res = await request(app).get('/api/localites?commune_id=1&limit=50');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const loc of res.body) {
      expect(loc.commune_id).toBe(1);
    }
  });

  it('should filter by departement_id', async () => {
    const res = await request(app).get('/api/localites?departement_id=7&limit=50');
    expect(res.statusCode).toBe(200);
    for (const loc of res.body) {
      expect(loc.departement_id).toBe(7);
    }
  });

  it('should filter by region_id', async () => {
    const res = await request(app).get('/api/localites?region_id=1&limit=50');
    expect(res.statusCode).toBe(200);
    for (const loc of res.body) {
      expect(loc.region_id).toBe(1);
    }
  });

  it('should support pagination with limit and offset', async () => {
    const page1 = await request(app).get('/api/localites?limit=5&offset=0');
    const page2 = await request(app).get('/api/localites?limit=5&offset=5');
    expect(page1.statusCode).toBe(200);
    expect(page2.statusCode).toBe(200);
    expect(page1.body.length).toBe(5);
    expect(page2.body.length).toBe(5);
    expect(page1.body[0].id).not.toBe(page2.body[0].id);
  });
});

describe('GET /api/localites/:id', () => {
  it('should return a single localite', async () => {
    const res = await request(app).get('/api/localites/1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('id', 1);
    expect(res.body).toHaveProperty('name');
  });

  it('should return 404 for non-existent localite', async () => {
    const res = await request(app).get('/api/localites/999999');
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/localites/search', () => {
  it('should search localites by name', async () => {
    const res = await request(app).get('/api/localites/search?q=Dakar');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const loc of res.body) {
      expect(loc.name.toLowerCase()).toContain('dakar');
    }
  });

  it('should return 400 if q is too short', async () => {
    const res = await request(app).get('/api/localites/search?q=a');
    expect(res.statusCode).toBe(400);
  });

  it('should return 400 if q is missing', async () => {
    const res = await request(app).get('/api/localites/search');
    expect(res.statusCode).toBe(400);
  });

  it('should respect limit parameter', async () => {
    const res = await request(app).get('/api/localites/search?q=Keur&limit=3');
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(3);
  });
});
