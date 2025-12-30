import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

export class DatabaseService {
    private pool: Pool | null = null;
    private static instance: DatabaseService;

    private constructor() { }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService();
        }
        return DatabaseService.instance;
    }

    public async connect() {
        if (config.db.useMock) {
            logger.info('Using MOCK Database configuration.');
            return;
        }

        if (!this.pool) {
            this.pool = new Pool({
                host: config.db.host,
                port: config.db.port,
                database: config.db.database,
                user: config.db.user,
                password: config.db.password,
                max: 10, // Max clients in pool
                idleTimeoutMillis: 30000
            });

            this.pool.on('error', (err) => {
                logger.error('Unexpected error on idle client', err);
                process.exit(-1);
            });

            // Test connection
            try {
                const client = await this.pool.connect();
                logger.info('Successfully connected to database');
                client.release();
            } catch (err: any) {
                logger.error('Failed to connect to database', { error: err.message });
                throw err;
            }
        }
    }

    public async upsertCampaign(campaign: any) {
        if (config.db.useMock) {
            logger.info(`[MOCK DB] Upserted campaign`, { id: campaign.id, name: campaign.name });
            return;
        }

        if (!this.pool) {
            throw new Error('Database not initialized. Call connect() first.');
        }

        const query = `
      INSERT INTO campaigns (
        id, name, status, budget, impressions, clicks, conversions, synced_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        budget = EXCLUDED.budget,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        conversions = EXCLUDED.conversions,
        synced_at = NOW();
    `;

        const values = [
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.budget,
            campaign.impressions,
            campaign.clicks,
            campaign.conversions
        ];

        try {
            await this.pool.query(query, values);
            logger.debug(`Saved campaign to DB`, { id: campaign.id });
        } catch (err: any) {
            logger.error(`Failed to save campaign to DB`, { id: campaign.id, error: err.message });
            throw err;
        }
    }

    public async close() {
        if (this.pool) {
            await this.pool.end();
            logger.info('Database connection pool closed');
        }
    }
}
