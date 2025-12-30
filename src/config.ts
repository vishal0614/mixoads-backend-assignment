import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  api: {
    baseUrl: process.env.AD_PLATFORM_API_URL || 'http://localhost:3001',
    auth: {
      email: process.env.API_USERNAME || 'admin@mixoads.com',
      password: process.env.API_PASSWORD || 'SuperSecret123!'
    },
    // 10 requests per minute = 1 request every 6 seconds
    // We add a safety buffer (e.g., 6.5s) to be safe
    minRequestIntervalMs: 6500, 
    timeoutMs: 10000,
    maxRetries: 3
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'mixoads',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    useMock: process.env.USE_MOCK_DB === 'true'
  }
};
