/**
 * Dropbox Service for Photoshop UXP Plugin
 * Handles all communication with Dropbox Cloud API v2
 * Full support for Dropbox Team/Business root namespaces and cursor pagination
 */

class DropboxService {
  constructor() {
    this.apiBase = 'https://api.dropboxapi.com/2';
    this.contentBase = 'https://content.dropboxapi.com/2';
    this.rootNamespaceId = null;
    this.systemFolders = new Set(['order', 'quote', 'free_trial', 'r&d team', 'example image library', 'llm training datasets']);
  }

  /**
   * Clean token of quotes, whitespace, or duplicate Bearer prefix
   */
  _cleanToken(token) {
    if (!token) return '';
    return token
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/^Bearer\s+/i, '')
      .trim();
  }

  /**
   * Build headers including Dropbox-API-Path-Root if on a Team Space
   */
  _getHeaders(token, contentType = 'application/json') {
    const cleanToken = this._cleanToken(token);
    const headers = {
      'Authorization': `Bearer ${cleanToken}`
    };
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    if (this.rootNamespaceId) {
      headers['Dropbox-API-Path-Root'] = JSON.stringify({
        '.tag': 'root',
        'root': this.rootNamespaceId
      });
    }
    return headers;
  }

  /**
   * Resolve root_namespace_id for Dropbox Business / Team Space
   */
  async ensureRootNamespace(token) {
    if (this.rootNamespaceId) return this.rootNamespaceId;

    const cleanToken = this._cleanToken(token);
    try {
      const response = await this._request(`${this.apiBase}/users/get_current_account`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Content-Type': 'application/json'
        },
        body: 'null'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.root_info && data.root_info.root_namespace_id) {
          this.rootNamespaceId = data.root_info.root_namespace_id;
        }
      }
    } catch (e) {
      console.warn('Could not resolve root namespace:', e.message);
    }
    return this.rootNamespaceId;
  }

  /**
   * Resilient HTTP Request helper: tries Fetch, falls back to XMLHttpRequest
   */
  async _request(url, options = {}) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (fetchErr) {
      console.warn('Fetch fallback to XHR:', fetchErr.message);

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(options.method || 'GET', url, true);

        if (options.headers) {
          for (const [key, value] of Object.entries(options.headers)) {
            xhr.setRequestHeader(key, value);
          }
        }

        xhr.onload = () => {
          resolve({
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            statusText: xhr.statusText,
            json: async () => {
              try {
                return JSON.parse(xhr.responseText);
              } catch (e) {
                return {};
              }
            },
            text: async () => xhr.responseText
          });
        };

        xhr.onerror = () => {
          reject(new Error(`Network error (${xhr.status || 'connection blocked'}).`));
        };

        xhr.send(options.body !== undefined ? options.body : null);
      });
    }
  }

  /**
   * Test Dropbox Connection and validate access token
   */
  async testConnection(token) {
    const cleanToken = this._cleanToken(token);
    if (!cleanToken) {
      throw new Error('Dropbox Access Token is required.');
    }

    this.rootNamespaceId = null;
    await this.ensureRootNamespace(cleanToken);

    const response = await this._request(`${this.apiBase}/users/get_current_account`, {
      method: 'POST',
      headers: this._getHeaders(cleanToken),
      body: 'null'
    });

    if (!response.ok) {
      const errText = await response.text();
      let message = 'Invalid Dropbox Token or connection failed.';
      try {
        const errJson = JSON.parse(errText);
        message = errJson.error_summary || errJson.error?.['.tag'] || message;
      } catch (e) {
        message = `${response.status} ${response.statusText || 'Unauthorized'}`;
      }
      throw new Error(message);
    }

    const data = await response.json();
    return {
      accountId: data.account_id,
      displayName: data.name ? data.name.display_name : 'Dropbox User',
      email: data.email || 'N/A'
    };
  }

  /**
   * Search across Dropbox to find which vendor folders contain the order
   */
  async searchOrderVendors(token, orderId) {
    const cleanToken = this._cleanToken(token);
    if (!cleanToken) throw new Error('Dropbox token not set.');
    if (!orderId) throw new Error('Order ID is required.');

    await this.ensureRootNamespace(cleanToken);

    // Extract digits or base ID
    const rawClean = orderId.replace(/^#+/, '').trim();
    const numMatch = rawClean.match(/\d+/);
    const searchQuery = numMatch ? numMatch[0] : rawClean;

    const vendorPaths = new Map(); // vendorName -> folderPath

    // 1. Perform search_v2 across Dropbox Team Space
    try {
      const response = await this._request(`${this.apiBase}/files/search_v2`, {
        method: 'POST',
        headers: this._getHeaders(cleanToken),
        body: JSON.stringify({
          query: searchQuery,
          options: {
            file_status: 'active',
            max_results: 100
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const matches = data.matches || [];
        for (const match of matches) {
          const meta = match.metadata && match.metadata.metadata ? match.metadata.metadata : match.metadata;
          const pathDisplay = meta && meta.path_display ? meta.path_display : '';
          if (pathDisplay) {
            const parts = pathDisplay.split('/').filter(Boolean);
            if (parts.length >= 2) {
              const vendorName = parts[0];
              if (this.systemFolders.has(vendorName.toLowerCase())) continue;

              const orderSegment = parts[1].replace(/^#+/, '').trim();
              if (orderSegment.includes(searchQuery) || orderSegment.toLowerCase().includes(rawClean.toLowerCase())) {
                const folderPath = `/${vendorName}/${parts[1]}`;
                if (!vendorPaths.has(vendorName)) {
                  vendorPaths.set(vendorName, folderPath);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('search_v2 error in UXP:', e.message);
    }

    // 2. Fetch all files inside each found vendor folder with cursor pagination
    const vendors = [];
    for (const [vName, vPath] of vendorPaths.entries()) {
      try {
        const { files, totalSize } = await this.getOrderFiles(cleanToken, vPath);
        if (files && files.length > 0) {
          vendors.push({
            vendorName: vName,
            folderPath: vPath,
            files: files,
            totalSize: totalSize,
            fileCount: files.length
          });
        }
      } catch (err) {
        console.error(`Error loading files for vendor ${vName}:`, err);
      }
    }

    return vendors;
  }

  /**
   * List all files inside a specific order folder with cursor pagination
   */
  async getOrderFiles(token, folderPath) {
    const files = [];
    let totalSize = 0;
    let hasMore = true;
    let cursor = null;

    while (hasMore) {
      const url = cursor ? `${this.apiBase}/files/list_folder/continue` : `${this.apiBase}/files/list_folder`;
      const body = cursor ? { cursor } : { path: folderPath, recursive: true };

      const response = await this._request(url, {
        method: 'POST',
        headers: this._getHeaders(token),
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Failed to list files in ${folderPath}`);
      }

      const data = await response.json();
      for (const entry of data.entries) {
        if (entry['.tag'] === 'file') {
          const ext = entry.name.includes('.') ? entry.name.split('.').pop().toLowerCase() : '';
          files.push({
            id: entry.id,
            name: entry.name,
            pathDisplay: entry.path_display,
            size: entry.size || 0,
            ext: ext,
            clientModified: entry.client_modified
          });
          totalSize += (entry.size || 0);
        }
      }

      hasMore = data.has_more;
      cursor = data.cursor;
    }

    return { files, totalSize };
  }

  /**
   * Download a file from Dropbox content API
   */
  downloadFile(token, dropboxPath, onProgress) {
    const cleanToken = this._cleanToken(token);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.contentBase}/files/download`);
      xhr.setRequestHeader('Authorization', `Bearer ${cleanToken}`);
      xhr.setRequestHeader('Dropbox-API-Arg', JSON.stringify({ path: dropboxPath }));
      if (this.rootNamespaceId) {
        xhr.setRequestHeader('Dropbox-API-Path-Root', JSON.stringify({
          '.tag': 'root',
          'root': this.rootNamespaceId
        }));
      }
      xhr.responseType = 'arraybuffer';

      xhr.onprogress = (evt) => {
        if (evt.lengthComputable && onProgress) {
          onProgress(evt.loaded, evt.total);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else {
          let errText = 'Download failed';
          try {
            const dec = new TextDecoder('utf-8');
            errText = dec.decode(xhr.response) || `${xhr.status} ${xhr.statusText}`;
          } catch (e) {
            errText = `${xhr.status} ${xhr.statusText}`;
          }
          reject(new Error(errText));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during file download.'));
      xhr.send();
    });
  }

  /**
   * Format bytes into readable string
   */
  formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}

// Export instance
window.dropboxService = new DropboxService();
