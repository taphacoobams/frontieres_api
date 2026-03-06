const request = require('supertest');
const app = require('../src/server');

describe('GET /health', () => {
  it('should return health status with database info', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('service', 'frontieres-api');
    expect(res.body).toHaveProperty('database');
    expect(res.body).toHaveProperty('timestamp');
    expect(['ok', 'degraded']).toContain(res.body.status);
  });
});

describe('GET /api/stats', () => {
  it('should return counts for all entities', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('regions');
    expect(res.body).toHaveProperty('departements');
    expect(res.body).toHaveProperty('communes');
    expect(res.body).toHaveProperty('localites');
    expect(res.body).toHaveProperty('localites_with_coordinates');
    expect(res.body.regions).toBe(14);
    expect(res.body.departements).toBe(46);
    expect(res.body.communes).toBe(552);
    expect(res.body.localites).toBeGreaterThan(0);
  });
});
