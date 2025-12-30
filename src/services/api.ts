import fetch, { Response, RequestInit } from 'node-fetch';
import { config } from '../config';
import { logger } from '../utils/logger';

// Custom error classes
export class ApiError extends Error {
    constructor(message: string, public status?: number, public code?: string) {
        super(message);
        this.name = 'ApiError';
    }
}

export class AdPlatformClient {
    private accessToken: string | null = null;
    private tokenExpiry: number = 0;

    // Rate limiting properties
    private lastRequestTime: number = 0;
    private minRequestInterval: number = config.api.minRequestIntervalMs;

    constructor() { }

    /**
     * Sleep functionality for delays
     */
    private async sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Enforce rate limits by waiting if necessary.
     * Simple "leaky bucket" / smoothing approach: ensure X ms between requests.
     */
    private async enforceRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < this.minRequestInterval) {
            const waitTime = this.minRequestInterval - timeSinceLastRequest;
            logger.debug(`Rate limiting: waiting ${waitTime}ms`);
            await this.sleep(waitTime);
        }

        this.lastRequestTime = Date.now();
    }

    /**
     * Authenticate with the API to get an access token.
     * Caches the token until it expires.
     */
    public async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        logger.info('Authenticating with Ad Platform API...');

        const authString = Buffer.from(`${config.api.auth.email}:${config.api.auth.password}`).toString('base64');

        try {
            // Note: We don't rate limit auth requests strictly unless they count towards the quota. 
            // Assuming they might, we'll just throttle normally or separate? 
            // Safest to just throttle everything.
            await this.enforceRateLimit();

            const response = await fetch(`${config.api.baseUrl}/auth/token`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${authString}`
                },
                timeout: config.api.timeoutMs
            } as any);

            if (!response.ok) {
                throw new ApiError(`Auth failed: ${response.statusText}`, response.status);
            }

            const data: any = await response.json();
            this.accessToken = data.access_token;
            // Default to 1 hour (3600s) if not provided, minus 30s buffer
            const expiresIn = (data.expires_in || 3600) * 1000;
            this.tokenExpiry = Date.now() + expiresIn - 30000;

            logger.info('Authentication successful');
            return this.accessToken as string;

        } catch (error: any) {
            logger.error('Authentication failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Generic fetch wrapper with Rate Limiting, Retries, and Timeout
     */
    private async request(endpoint: string, options: RequestInit = {}, retryCount = 0): Promise<any> {
        const url = `${config.api.baseUrl}${endpoint}`;

        try {
            // 1. Ensure Auth (except for auth endpoint which is handled separately)
            // Note: This creates a recursive dependency if we use request() for auth.
            // So we handle auth headers manually here.
            const token = await this.getAccessToken();

            const headers = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                ...options.headers
            };

            // 2. Rate Limit
            await this.enforceRateLimit();

            // 3. Make Request with Refresh Logic & Retries
            logger.debug(`Requesting ${endpoint}`);

            // Add timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.api.timeoutMs);

            try {
                const response = await fetch(url, {
                    ...options,
                    headers,
                    signal: controller.signal
                } as any); // Cast to any because node-fetch types might conflict with DOM types slightly

                clearTimeout(timeoutId);

                // Handle 429 Too Many Requests explicitly
                if (response.status === 429) {
                    const retryAfter = response.headers.get('retry-after');
                    const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 2000 * Math.pow(2, retryCount); // fallback backoff
                    logger.warn(`Rate limit hit (429). Waiting ${waitMs}ms before retry...`);
                    await this.sleep(waitMs);
                    return this.request(endpoint, options, retryCount + 1);
                }

                // Handle 503 Service Unavailable / 5xx errors
                if (response.status >= 500) {
                    if (retryCount < config.api.maxRetries) {
                        const waitMs = 1000 * Math.pow(2, retryCount);
                        logger.warn(`Server error ${response.status}. Retrying in ${waitMs}ms...`);
                        await this.sleep(waitMs);
                        return this.request(endpoint, options, retryCount + 1);
                    }
                }

                // Handle 401 Unauthorized (Token expiry logic fallback)
                if (response.status === 401) {
                    // Force token refresh
                    this.accessToken = null;
                    this.tokenExpiry = 0;
                    if (retryCount < 2) {
                        logger.warn('Token expired or invalid (401), refreshing...');
                        return this.request(endpoint, options, retryCount + 1);
                    }
                }

                if (!response.ok) {
                    throw new ApiError(`API Error: ${response.status} ${response.statusText}`, response.status);
                }

                return await response.json();

            } catch (err: any) {
                clearTimeout(timeoutId);

                // Handle Timeout specifically
                if (err.name === 'AbortError') {
                    if (retryCount < config.api.maxRetries) {
                        logger.warn('Request timed out. Retrying...');
                        return this.request(endpoint, options, retryCount + 1);
                    }
                    throw new ApiError('Request timeout', 408);
                }

                // Re-throw if it's already an ApiError (from recursive calls) or if we shouldn't retry
                if (err instanceof ApiError) throw err;

                // Network errors (like ECONNRESET)
                if (retryCount < config.api.maxRetries) {
                    const waitMs = 1000 * Math.pow(2, retryCount);
                    logger.warn(`Network error: ${err.message}. Retrying in ${waitMs}ms...`, err);
                    await this.sleep(waitMs);
                    return this.request(endpoint, options, retryCount + 1);
                }

                throw err;
            }

        } catch (error: any) {
            // Log only the first time we Bubble up the final error
            if (retryCount === 0) {
                logger.error(`Final failure for ${endpoint}: ${error.message}`);
            }
            throw error;
        }
    }

    public async getCampaigns(page: number, limit: number = 10) {
        return this.request(`/api/campaigns?page=${page}&limit=${limit}`, {
            method: 'GET'
        });
    }

    public async syncCampaign(campaignId: string) {
        return this.request(`/api/campaigns/${campaignId}/sync`, {
            method: 'POST',
            body: JSON.stringify({ campaign_id: campaignId })
        });
    }
}
