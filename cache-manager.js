/**
 * Cache Manager for Photoshop UXP Plugin
 * Handles local temporary caching, fast re-opening, and cache purge
 */

class CacheManager {
  constructor() {
    this.fs = null;
    this.formats = null;
    this.baseCacheFolder = null;
    this.initFileSystem();
  }

  initFileSystem() {
    try {
      if (typeof require !== 'undefined') {
        const uxp = require('uxp');
        if (uxp && uxp.storage) {
          this.fs = uxp.storage.localFileSystem;
          this.formats = uxp.storage.formats;
        }
      }
    } catch (e) {
      console.warn('UXP storage not available in this environment:', e.message);
    }
  }

  /**
   * Get or create the base cache folder
   * Default: UXP temporaryFolder / "OrderOpenerCache"
   */
  async getCacheFolder() {
    if (this.baseCacheFolder) return this.baseCacheFolder;
    if (!this.fs) throw new Error('UXP FileSystem is not initialized.');

    // Get default temporary folder
    const tempFolder = await this.fs.getTemporaryFolder();
    try {
      // Look for or create 'OrderOpenerCache'
      let folder;
      try {
        folder = await tempFolder.getEntry('OrderOpenerCache');
      } catch (notFound) {
        folder = await tempFolder.createFolder('OrderOpenerCache');
      }
      this.baseCacheFolder = folder;
      return this.baseCacheFolder;
    } catch (err) {
      this.baseCacheFolder = tempFolder;
      return tempFolder;
    }
  }

  /**
   * Check if a file is already downloaded in cache with identical size
   * @param {string} orderId
   * @param {string} fileName
   * @param {number} expectedSize
   * @returns {Promise<Object|null>} fileEntry if cached, else null
   */
  async getCachedFile(orderId, fileName, expectedSize) {
    try {
      const cacheRoot = await this.getCacheFolder();
      const cleanOrderId = orderId.replace(/^#/, '');

      let orderFolder;
      try {
        orderFolder = await cacheRoot.getEntry(cleanOrderId);
      } catch (e) {
        return null; // Order folder doesn't exist yet
      }

      if (!orderFolder || !orderFolder.isFolder) return null;

      let fileEntry;
      try {
        fileEntry = await orderFolder.getEntry(fileName);
      } catch (e) {
        return null; // File doesn't exist yet
      }

      if (fileEntry && fileEntry.isFile) {
        // If expectedSize is provided, verify match
        if (expectedSize !== undefined && expectedSize > 0) {
          try {
            // In UXP, fileEntry.size or metadata can give file size
            const meta = await fileEntry.getMetadata ? await fileEntry.getMetadata() : null;
            const actualSize = meta ? meta.size : (fileEntry.size || 0);
            if (actualSize > 0 && Math.abs(actualSize - expectedSize) > 5) {
              return null; // Size mismatch, re-download
            }
          } catch (mErr) {
            // Ignore metadata read failure, assume file is good
          }
        }
        return fileEntry;
      }
    } catch (err) {
      console.warn('Check cached file error:', err);
    }
    return null;
  }

  /**
   * Save downloaded binary data into local cache folder
   * @param {string} orderId
   * @param {string} fileName
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<Object>} fileEntry
   */
  async saveFileToCache(orderId, fileName, arrayBuffer) {
    const cacheRoot = await this.getCacheFolder();
    const cleanOrderId = orderId.replace(/^#/, '');

    // Get or create order folder
    let orderFolder;
    try {
      orderFolder = await cacheRoot.getEntry(cleanOrderId);
    } catch (e) {
      orderFolder = await cacheRoot.createFolder(cleanOrderId);
    }

    // Create file
    const fileEntry = await orderFolder.createFile(fileName, { overwrite: true });
    await fileEntry.write(arrayBuffer, { format: this.formats.binary });
    return fileEntry;
  }

  /**
   * Calculate total size and number of files in the cache
   * @returns {Promise<{ totalBytes: number, fileCount: number }>}
   */
  async getCacheStats() {
    let totalBytes = 0;
    let fileCount = 0;

    try {
      const cacheRoot = await this.getCacheFolder();
      const entries = await cacheRoot.getEntries();

      for (const entry of entries) {
        if (entry.isFolder) {
          const files = await entry.getEntries();
          for (const f of files) {
            if (f.isFile) {
              fileCount++;
              try {
                const meta = await f.getMetadata ? await f.getMetadata() : null;
                totalBytes += meta ? (meta.size || 0) : (f.size || 0);
              } catch (e) {
                // Ignore single file metadata error
              }
            }
          }
        } else if (entry.isFile) {
          fileCount++;
          try {
            const meta = await entry.getMetadata ? await entry.getMetadata() : null;
            totalBytes += meta ? (meta.size || 0) : (entry.size || 0);
          } catch (e) {}
        }
      }
    } catch (err) {
      console.warn('Error reading cache stats:', err);
    }

    return { totalBytes, fileCount };
  }

  /**
   * Clear all cached files and folders
   * @returns {Promise<boolean>}
   */
  async clearCache() {
    try {
      const cacheRoot = await this.getCacheFolder();
      const entries = await cacheRoot.getEntries();

      for (const entry of entries) {
        try {
          if (entry.isFolder) {
            const subEntries = await entry.getEntries();
            for (const sub of subEntries) {
              await sub.delete();
            }
            await entry.delete();
          } else if (entry.isFile) {
            await entry.delete();
          }
        } catch (delErr) {
          console.warn('Failed to delete cache entry:', entry.name, delErr);
        }
      }
      return true;
    } catch (err) {
      console.error('Clear cache error:', err);
      return false;
    }
  }
}

// Export instance
window.cacheManager = new CacheManager();
