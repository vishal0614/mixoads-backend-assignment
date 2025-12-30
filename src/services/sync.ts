import { AdPlatformClient } from './api';
import { DatabaseService } from './db';
import { logger } from '../utils/logger';

export class SyncService {
    private api: AdPlatformClient;
    private db: DatabaseService;

    constructor() {
        this.api = new AdPlatformClient();
        this.db = DatabaseService.getInstance();
    }

    public async start() {
        logger.info('Starting Campaign Sync Service...');

        try {
            await this.db.connect();

            // 1. Fetch all campaigns (pagination)
            const allCampaigns = await this.fetchAllCampaigns();
            logger.info(`Fetched ${allCampaigns.length} total campaigns from API.`);

            // 2. Sync each campaign
            let successCount = 0;
            let failureCount = 0;

            for (let i = 0; i < allCampaigns.length; i++) {
                const campaign = allCampaigns[i];
                logger.info(`[${i + 1}/${allCampaigns.length}] Processing campaign: ${campaign.name} (${campaign.id})`);

                try {
                    // Trigger sync on remote API (simulating data processing)
                    await this.api.syncCampaign(campaign.id);

                    // Save to local DB
                    await this.db.upsertCampaign(campaign);

                    successCount++;
                    logger.info(`Successfully synced ${campaign.name}`);
                } catch (error: any) {
                    failureCount++;
                    logger.error(`Failed to sync campaign ${campaign.id}`, { error: error.message });
                    // Continue to next campaign even if one fails
                }
            }

            logger.info('Sync Service Completed', { successful: successCount, failed: failureCount, total: allCampaigns.length });

        } catch (error: any) {
            logger.error('Fatal error in Sync Service', { error: error.message });
            throw error;
        } finally {
            await this.db.close();
        }
    }

    private async fetchAllCampaigns() {
        let allCampaigns: any[] = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            logger.info(`Fetching campaigns page ${page}...`);
            const response = await this.api.getCampaigns(page);

            if (response && response.data) {
                allCampaigns = allCampaigns.concat(response.data);

                // Check pagination info
                // Structure: { data: [...], pagination: { page: 1, limit: 10, has_more: true } }
                hasMore = response.pagination.has_more;
                if (hasMore) {
                    page++;
                }
            } else {
                hasMore = false;
                logger.warn('Unexpected response format from API', { response });
            }
        }

        return allCampaigns;
    }
}
