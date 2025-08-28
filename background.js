class PrivacyAnalyzerBackground {
  constructor() {
    this.analysisCache = new Map();
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
    this.requestQueue = new Map();
    this.rateLimitDelay = 1000; // 1 second between requests
    
    this.init();
  }

  init() {
    // Handle extension installation
    chrome.runtime.onInstalled.addListener((details) => {
      this.handleInstallation(details);
    });

    // Handle messages between extension components
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async response
    });

    // Clean up expired cache periodically
    setInterval(() => {
      this.cleanupExpiredCache();
    }, 60 * 60 * 1000); // Every hour
  }

  handleInstallation(details) {
    console.log('Privacy Analyzer installed:', details.reason);
    
    if (details.reason === 'install') {
      // Set up default settings
      chrome.storage.sync.set({
        firstInstall: Date.now(),
        analysisCount: 0
      });
    }
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'cacheAnalysis':
          await this.cacheAnalysisResult(request.url, request.analysis);
          sendResponse({ success: true });
          break;

        case 'getCachedAnalysis':
          const cached = await this.getCachedAnalysis(request.url);
          sendResponse({ analysis: cached });
          break;

        case 'incrementAnalysisCount':
          await this.incrementAnalysisCount();
          sendResponse({ success: true });
          break;

        case 'getStats':
          const stats = await this.getExtensionStats();
          sendResponse({ stats: stats });
          break;

        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Background script error:', error);
      sendResponse({ error: error.message });
    }
  }

  async cacheAnalysisResult(url, analysis) {
    try {
      const cacheKey = this.generateCacheKey(url);
      const cacheData = {
        analysis: analysis,
        timestamp: Date.now(),
        url: url
      };

      // Store in memory cache
      this.analysisCache.set(cacheKey, cacheData);

      // Store in Chrome storage for persistence
      const storageKey = `analysis_${cacheKey}`;
      await chrome.storage.local.set({ [storageKey]: cacheData });

      console.log('Analysis cached for:', url);
    } catch (error) {
      console.error('Failed to cache analysis:', error);
    }
  }

  async getCachedAnalysis(url) {
    try {
      const cacheKey = this.generateCacheKey(url);

      // Check memory cache first
      let cached = this.analysisCache.get(cacheKey);

      // If not in memory, check storage
      if (!cached) {
        const storageKey = `analysis_${cacheKey}`;
        const result = await chrome.storage.local.get(storageKey);
        cached = result[storageKey];

        // Update memory cache
        if (cached) {
          this.analysisCache.set(cacheKey, cached);
        }
      }

      // Check if cache is expired
      if (cached) {
        const age = Date.now() - cached.timestamp;
        if (age > this.cacheExpiry) {
          await this.removeCachedAnalysis(cacheKey);
          return null;
        }
        return cached.analysis;
      }

      return null;
    } catch (error) {
      console.error('Failed to get cached analysis:', error);
      return null;
    }
  }

  async removeCachedAnalysis(cacheKey) {
    try {
      // Remove from memory cache
      this.analysisCache.delete(cacheKey);

      // Remove from storage
      const storageKey = `analysis_${cacheKey}`;
      await chrome.storage.local.remove(storageKey);
    } catch (error) {
      console.error('Failed to remove cached analysis:', error);
    }
  }

  generateCacheKey(url) {
    // Create a simple hash of the URL for caching
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  async cleanupExpiredCache() {
    try {
      const storage = await chrome.storage.local.get(null);
      const now = Date.now();
      const keysToRemove = [];

      // Check all stored analysis results
      Object.entries(storage).forEach(([key, value]) => {
        if (key.startsWith('analysis_') && value.timestamp) {
          const age = now - value.timestamp;
          if (age > this.cacheExpiry) {
            keysToRemove.push(key);
            
            // Also remove from memory cache
            const cacheKey = key.replace('analysis_', '');
            this.analysisCache.delete(cacheKey);
          }
        }
      });

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        console.log(`Cleaned up ${keysToRemove.length} expired cache entries`);
      }
    } catch (error) {
      console.error('Failed to cleanup expired cache:', error);
    }
  }

  async incrementAnalysisCount() {
    try {
      const result = await chrome.storage.sync.get(['analysisCount']);
      const currentCount = result.analysisCount || 0;
      await chrome.storage.sync.set({ 
        analysisCount: currentCount + 1,
        lastAnalysis: Date.now()
      });
    } catch (error) {
      console.error('Failed to increment analysis count:', error);
    }
  }

  async getExtensionStats() {
    try {
      const syncData = await chrome.storage.sync.get(['analysisCount', 'firstInstall', 'lastAnalysis']);
      const localStorage = await chrome.storage.local.get(null);
      
      // Count cached analyses
      const cachedCount = Object.keys(localStorage).filter(key => 
        key.startsWith('analysis_')
      ).length;

      return {
        totalAnalyses: syncData.analysisCount || 0,
        cachedAnalyses: cachedCount,
        firstInstall: syncData.firstInstall || Date.now(),
        lastAnalysis: syncData.lastAnalysis || null,
        memoryCache: this.analysisCache.size
      };
    } catch (error) {
      console.error('Failed to get extension stats:', error);
      return {
        totalAnalyses: 0,
        cachedAnalyses: 0,
        firstInstall: Date.now(),
        lastAnalysis: null,
        memoryCache: 0
      };
    }
  }

  // Rate limiting for API requests
  async rateLimitRequest(requestId) {
    const now = Date.now();
    const lastRequest = this.requestQueue.get(requestId) || 0;
    const timeSinceLastRequest = now - lastRequest;

    if (timeSinceLastRequest < this.rateLimitDelay) {
      const waitTime = this.rateLimitDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.requestQueue.set(requestId, Date.now());
  }
}

// Initialize the background service worker
const privacyAnalyzerBackground = new PrivacyAnalyzerBackground();