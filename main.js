/**
 * Main Controller for Dropbox Order Opener UXP Plugin
 * Connects UI, Order Queue, Dropbox Service, Cache Manager, and Photoshop DOM
 */

(function () {
  'use strict';

  // Photoshop API references
  let psApp = null;
  let psCore = null;
  let psConstants = null;

  try {
    if (typeof require !== 'undefined') {
      const photoshop = require('photoshop');
      if (photoshop) {
        psApp = photoshop.app;
        psCore = photoshop.core;
        psConstants = photoshop.constants;
      }
    }
  } catch (e) {
    console.warn('Photoshop DOM API not directly accessible:', e.message);
  }

  // DOM Elements
  const mainContainer = document.querySelector('.main-container');
  const orderInput = document.getElementById('orderInput');
  const loadOrdersBtn = document.getElementById('loadOrdersBtn');
  const clearInputBtn = document.getElementById('clearInputBtn');

  const queueSection = document.getElementById('queueSection');
  const queueCount = document.getElementById('queueCount');
  const queueListContainer = document.getElementById('queueListContainer');
  const prevOrderBtn = document.getElementById('prevOrderBtn');
  const nextOrderBtn = document.getElementById('nextOrderBtn');
  const clearQueueBtn = document.getElementById('clearQueueBtn');

  const activeOrderSummary = document.getElementById('activeOrderSummary');
  const activeOrderTitle = document.getElementById('activeOrderTitle');
  const markDoneBtn = document.getElementById('markDoneBtn');
  const closeActiveOrderBtn = document.getElementById('closeActiveOrderBtn');

  const orderFoundBadge = document.getElementById('orderFoundBadge');
  const vendorPlaceholder = document.getElementById('vendorPlaceholder');
  const vendorLoading = document.getElementById('vendorLoading');
  const vendorLoadingText = document.getElementById('vendorLoadingText');
  const vendorsList = document.getElementById('vendorsList');
  const orderActionsBar = document.getElementById('orderActionsBar');
  const openAllFilesBtn = document.getElementById('openAllFilesBtn');
  const closeDocsBtn = document.getElementById('closeDocsBtn');

  const statusMessage = document.getElementById('statusMessage');
  const progressPercent = document.getElementById('progressPercent');
  const progressFill = document.getElementById('progressFill');

  // Settings Elements
  const settingsView = document.getElementById('settingsView');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const dropboxTokenInput = document.getElementById('dropboxToken');
  const testConnectionBtn = document.getElementById('testConnectionBtn');
  const connectionSpinner = document.getElementById('connectionSpinner');
  const connectionStatusAlert = document.getElementById('connectionStatusAlert');
  const cacheDirPath = document.getElementById('cacheDirPath');
  const browseCacheBtn = document.getElementById('browseCacheBtn');
  const cacheStatsText = document.getElementById('cacheStatsText');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const viewGuideLink = document.getElementById('viewGuideLink');
  const toggleTokenVisibilityBtn = document.getElementById('toggleTokenVisibilityBtn');
  const loadConfigTokenBtn = document.getElementById('loadConfigTokenBtn');

  // Update & Reload Elements
  const reloadPanelBtn = document.getElementById('reloadPanelBtn');
  const checkUpdateBtn = document.getElementById('checkUpdateBtn');
  const quickReloadBtn = document.getElementById('quickReloadBtn');
  const updateNotice = document.getElementById('updateNotice');
  const updateActionBox = document.getElementById('updateActionBox');
  const updateActionText = document.getElementById('updateActionText');
  const updateChangelogText = document.getElementById('updateChangelogText');
  const installUpdateBtn = document.getElementById('installUpdateBtn');

  // State
  let currentActiveOrderId = null;
  let currentSelectedVendor = null;

  // Initialize
  init();

  function init() {
    loadSettings();
    updateCacheStats();

    // Setup queue subscription
    window.orderQueue.subscribe(renderQueue);

    // Event listeners
    loadOrdersBtn.addEventListener('click', handleLoadOrders);
    clearInputBtn.addEventListener('click', () => { orderInput.value = ''; });
    orderInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        handleLoadOrders();
      }
    });

    prevOrderBtn.addEventListener('click', () => window.orderQueue.prevOrder());
    nextOrderBtn.addEventListener('click', () => window.orderQueue.nextOrder());
    clearQueueBtn.addEventListener('click', () => window.orderQueue.clearDone());

    markDoneBtn.addEventListener('click', () => {
      window.orderQueue.markDone();
    });

    closeActiveOrderBtn.addEventListener('click', () => {
      window.orderQueue.removeOrder(window.orderQueue.currentIndex);
    });

    openAllFilesBtn.addEventListener('click', handleOpenAllFiles);
    closeDocsBtn.addEventListener('click', handleCloseAllDocuments);

    // Settings listeners with view visibility toggle (prevents control bleed-through)
    openSettingsBtn.addEventListener('click', openSettings);
    closeSettingsBtn.addEventListener('click', closeSettings);
    saveSettingsBtn.addEventListener('click', handleSaveSettings);
    testConnectionBtn.addEventListener('click', handleTestConnection);
    clearCacheBtn.addEventListener('click', handleClearCache);

    if (toggleTokenVisibilityBtn) {
      toggleTokenVisibilityBtn.addEventListener('click', () => {
        if (dropboxTokenInput.type === 'password') {
          dropboxTokenInput.type = 'text';
          toggleTokenVisibilityBtn.textContent = 'Hide';
        } else {
          dropboxTokenInput.type = 'password';
          toggleTokenVisibilityBtn.textContent = 'Show';
        }
      });
    }

    if (loadConfigTokenBtn) {
      loadConfigTokenBtn.addEventListener('click', loadFromConfigFile);
    }

    if (viewGuideLink) {
      viewGuideLink.addEventListener('click', (e) => {
        e.preventDefault();
        setStatus('Check SETUP_DROPBOX_GUIDE.md in plugin folder.');
      });
    }

    if (reloadPanelBtn) {
      reloadPanelBtn.addEventListener('click', handleReloadPanel);
    }
    if (quickReloadBtn) {
      quickReloadBtn.addEventListener('click', handleReloadPanel);
    }
    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener('click', handleCheckUpdates);
    }

    setStatus('Ready. Enter Order ID(s) to begin.');
  }

  function handleReloadPanel() {
    setStatus('Reloading plugin panel...');
    setTimeout(() => {
      window.location.reload();
    }, 120);
  }

  async function handleCheckUpdates() {
    if (updateNotice) {
      updateNotice.innerHTML = 'Connecting to GitHub to check for updates...';
      updateNotice.style.color = 'var(--accent-blue)';
    }
    if (updateActionBox) updateActionBox.style.display = 'none';

    try {
      let currentVersion = '2.2.0';
      if (typeof require !== 'undefined') {
        const uxp = require('uxp');
        if (uxp && uxp.storage) {
          const fs = uxp.storage.localFileSystem;
          const pluginFolder = await fs.getPluginFolder();
          const manifestFile = await pluginFolder.getEntry('manifest.json');
          if (manifestFile) {
            const text = await manifestFile.read();
            const manifestData = JSON.parse(text);
            if (manifestData.version) currentVersion = manifestData.version;
          }
        }
      }

      const GITHUB_VERSION_URL = 'https://raw.githubusercontent.com/bishojit-sarker/Dropbox-Order-Opener/main/version.json';
      const res = await fetch(`${GITHUB_VERSION_URL}?_t=${Date.now()}`);
      
      if (res.ok) {
        const remote = await res.json();
        const remoteVer = remote.version || '2.2.0';
        
        if (isNewerVersion(remoteVer, currentVersion)) {
          if (updateActionBox) {
            updateActionBox.style.display = 'block';
            if (updateActionText) updateActionText.textContent = `🚀 Update v${remoteVer} Available!`;
            if (updateChangelogText) updateChangelogText.textContent = remote.changelog || 'Latest improvements and bug fixes.';
            if (installUpdateBtn) {
              installUpdateBtn.disabled = false;
              installUpdateBtn.textContent = `⚡ Install & Apply Update (v${remoteVer})`;
              installUpdateBtn.onclick = () => handleInstallRemoteUpdate(remote);
            }
          }
          if (updateNotice) {
            updateNotice.innerHTML = `A new version <strong>v${remoteVer}</strong> is available on GitHub! Click "Install & Apply Update" below.`;
            updateNotice.style.color = 'var(--accent-blue)';
          }
          setStatus(`Update v${remoteVer} is available!`);
        } else {
          if (updateNotice) {
            updateNotice.innerHTML = `✓ You have the latest version (<strong>v${currentVersion}</strong>). Synced with GitHub.`;
            updateNotice.style.color = 'var(--accent-green)';
          }
          setStatus(`Plugin v${currentVersion} is up to date.`);
        }
      } else {
        if (updateNotice) {
          updateNotice.innerHTML = `✓ Current version: <strong>v${currentVersion}</strong>.<br/>Run <code>Install-Or-Update-Plugin.bat</code> to update from repository.`;
          updateNotice.style.color = 'var(--text-secondary)';
        }
      }
    } catch (e) {
      if (updateNotice) {
        updateNotice.innerHTML = `Notice: Local version loaded. Use <code>Install-Or-Update-Plugin.bat</code> to sync updates.`;
        updateNotice.style.color = 'var(--text-secondary)';
      }
    }
  }

  async function handleInstallRemoteUpdate(remote) {
    if (!installUpdateBtn) return;
    installUpdateBtn.disabled = true;
    installUpdateBtn.textContent = 'Downloading files from GitHub...';

    try {
      if (typeof require === 'undefined') throw new Error('UXP API not accessible');
      const uxp = require('uxp');
      const fs = uxp.storage.localFileSystem;
      const pluginFolder = await fs.getPluginFolder();

      const files = remote.files || [
        'manifest.json',
        'index.html',
        'style.css',
        'main.js',
        'dropbox-service.js',
        'order-queue.js',
        'cache-manager.js'
      ];
      const rawBase = remote.raw_base_url || 'https://raw.githubusercontent.com/bishojit-sarker/Dropbox-Order-Opener/main';

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        installUpdateBtn.textContent = `Downloading (${i + 1}/${files.length}): ${file}...`;
        const fRes = await fetch(`${rawBase}/${file}?_t=${Date.now()}`);
        if (!fRes.ok) throw new Error(`Could not fetch ${file} (HTTP ${fRes.status})`);
        const text = await fRes.text();
        const entry = await pluginFolder.createFile(file, { overwrite: true });
        await entry.write(text);
      }

      // Write updated version.json
      const vEntry = await pluginFolder.createFile('version.json', { overwrite: true });
      await vEntry.write(JSON.stringify(remote, null, 2));

      installUpdateBtn.textContent = '✓ Updated! Reloading panel...';
      if (updateNotice) {
        updateNotice.innerHTML = `✓ Successfully updated to <strong>v${remote.version}</strong>! Reloading...`;
        updateNotice.style.color = 'var(--accent-green)';
      }

      setTimeout(() => {
        window.location.reload();
      }, 900);
    } catch (err) {
      console.error('Remote update failed:', err);
      installUpdateBtn.disabled = false;
      installUpdateBtn.textContent = 'Retry Update';
      if (updateNotice) {
        updateNotice.innerHTML = `⚠️ Live update failed: ${err.message}. Please run <code>Install-Or-Update-Plugin.bat</code> to update.`;
        updateNotice.style.color = 'var(--accent-red)';
      }
    }
  }

  function isNewerVersion(remote, local) {
    if (!remote || !local) return false;
    const r = remote.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const l = local.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
      const rv = r[i] || 0;
      const lv = l[i] || 0;
      if (rv > lv) return true;
      if (rv < lv) return false;
    }
    return false;
  }

  function openSettings() {
    if (mainContainer) mainContainer.style.display = 'none';
    settingsView.classList.add('active');
    updateCacheStats();
  }

  function closeSettings() {
    settingsView.classList.remove('active');
    if (mainContainer) mainContainer.style.display = 'flex';
  }

  // Settings Storage
  async function loadSettings() {
    let token = localStorage.getItem('dropbox_access_token') || '';
    if (!token) {
      token = await readTokenFromPluginConfig();
      if (token) {
        localStorage.setItem('dropbox_access_token', token);
      }
    }
    dropboxTokenInput.value = token;

    const customCache = localStorage.getItem('custom_cache_path') || '';
    if (customCache) {
      cacheDirPath.value = customCache;
    }
  }

  async function loadFromConfigFile() {
    const token = await readTokenFromPluginConfig();
    if (token) {
      dropboxTokenInput.value = token;
      localStorage.setItem('dropbox_access_token', token);
      showConnectionAlert('Token loaded from config.json! Click Test Connection to verify.', true);
    } else {
      showConnectionAlert('Could not read token from config.json.', false);
    }
  }

  async function readTokenFromPluginConfig() {
    try {
      if (typeof require !== 'undefined') {
        const uxp = require('uxp');
        if (uxp && uxp.storage) {
          const fs = uxp.storage.localFileSystem;
          const pluginFolder = await fs.getPluginFolder();
          const configFile = await pluginFolder.getEntry('config.json');
          if (configFile) {
            const text = await configFile.read();
            const data = JSON.parse(text);
            return data.dropbox_token || '';
          }
        }
      }
    } catch (e) {
      console.warn('readTokenFromPluginConfig error:', e);
    }
    return '';
  }

  function handleSaveSettings() {
    const token = dropboxTokenInput.value.trim();
    localStorage.setItem('dropbox_access_token', token);

    closeSettings();
    setStatus('Settings saved successfully.');

    // If an order is currently active and had error, retry
    const active = window.orderQueue.getActiveOrder();
    if (active && (!active.vendors || active.vendors.length === 0)) {
      fetchVendorsForOrder(active);
    }
  }

  async function handleTestConnection() {
    const token = dropboxTokenInput.value.trim();
    if (!token) {
      showConnectionAlert('Please enter an Access Token first.', false);
      return;
    }

    connectionSpinner.style.display = 'inline';
    connectionStatusAlert.style.display = 'none';

    try {
      const account = await window.dropboxService.testConnection(token);
      showConnectionAlert(`Connected to: ${account.displayName} (${account.email})`, true);
      setStatus(`Connected to Dropbox account: ${account.displayName}`);
    } catch (err) {
      showConnectionAlert(`Error: ${err.message}`, false);
      setStatus(`Dropbox connection failed.`);
    } finally {
      connectionSpinner.style.display = 'none';
    }
  }

  function showConnectionAlert(msg, isSuccess) {
    connectionStatusAlert.textContent = msg;
    connectionStatusAlert.className = `status-alert ${isSuccess ? 'success' : 'error'}`;
    connectionStatusAlert.style.display = 'block';
  }

  async function updateCacheStats() {
    try {
      const stats = await window.cacheManager.getCacheStats();
      const formatted = window.dropboxService.formatBytes(stats.totalBytes);
      cacheStatsText.textContent = `Used: ${formatted} (${stats.fileCount} files)`;
    } catch (e) {
      cacheStatsText.textContent = 'Used: 0 B (0 files)';
    }
  }

  async function handleClearCache() {
    setStatus('Clearing cache...');
    const ok = await window.cacheManager.clearCache();
    if (ok) {
      setStatus('Cache cleared successfully.');
      updateCacheStats();
    } else {
      setStatus('Failed to clear some cache files.');
    }
  }

  // Queue Handling
  function handleLoadOrders() {
    const text = orderInput.value.trim();
    if (!text) {
      setStatus('Please enter at least one Order ID.');
      return;
    }

    const added = window.orderQueue.addOrders(text);
    if (added > 0) {
      orderInput.value = '';
      setStatus(`Loaded ${added} order(s) into queue.`);
    } else {
      setStatus('No new Order IDs found or orders already in queue.');
    }
  }

  function renderQueue(queue) {
    if (queue.orders.length === 0) {
      queueSection.style.display = 'none';
      activeOrderSummary.style.display = 'none';
      vendorPlaceholder.style.display = 'block';
      vendorPlaceholder.innerHTML = `
        <div class="icon">📁</div>
        <p>No active order in queue.</p>
        <p style="font-size: 10px; margin-top: 4px;">Enter Order ID(s) above and click "Load to Queue".</p>
      `;
      vendorLoading.style.display = 'none';
      vendorsList.style.display = 'none';
      orderActionsBar.style.display = 'none';
      orderFoundBadge.textContent = '';
      currentActiveOrderId = null;
      return;
    }

    queueSection.style.display = 'block';
    queueCount.textContent = queue.orders.length;
    prevOrderBtn.disabled = !queue.hasPrev();
    nextOrderBtn.disabled = !queue.hasNext();

    // Render chips
    queueListContainer.innerHTML = '';
    queue.orders.forEach((order, idx) => {
      const chip = document.createElement('div');
      const isActive = idx === queue.currentIndex;
      chip.className = `order-chip ${isActive ? 'active' : ''} ${order.status === 'done' ? 'done' : ''}`;
      
      const statusIcon = order.status === 'done' ? '✓ ' : '';
      chip.innerHTML = `
        <span>${statusIcon}${order.id}</span>
        <span class="chip-close" title="Remove order">✕</span>
      `;

      chip.addEventListener('click', (e) => {
        if (e.target.classList.contains('chip-close')) {
          e.stopPropagation();
          queue.removeOrder(idx);
        } else {
          queue.setActive(idx);
        }
      });

      queueListContainer.appendChild(chip);
    });

    // Active order check
    const active = queue.getActiveOrder();
    if (active) {
      activeOrderSummary.style.display = 'flex';
      activeOrderTitle.textContent = active.id;
      if (active.status === 'done') {
        activeOrderTitle.innerHTML = `<strike>${active.id}</strike> (Done)`;
      }

      // If active order changed, query Dropbox
      if (currentActiveOrderId !== active.id) {
        currentActiveOrderId = active.id;
        fetchVendorsForOrder(active);
      }
    }
  }

  // Fetch Vendors and Order Files from Dropbox
  async function fetchVendorsForOrder(order) {
    const token = localStorage.getItem('dropbox_access_token');
    if (!token) {
      vendorPlaceholder.style.display = 'block';
      vendorPlaceholder.innerHTML = `
        <div class="icon">🔑</div>
        <p style="color: #ff9da4;">Dropbox Access Token Missing</p>
        <p style="font-size: 10px; margin-top: 4px;">Please open Settings (⚙) and enter your Dropbox Token.</p>
        <button class="btn btn-sm btn-primary" style="margin-top: 8px;" id="openSettingsPromptBtn">Open Settings</button>
      `;
      vendorLoading.style.display = 'none';
      vendorsList.style.display = 'none';
      orderActionsBar.style.display = 'none';
      const promptBtn = document.getElementById('openSettingsPromptBtn');
      if (promptBtn) promptBtn.addEventListener('click', openSettings);
      return;
    }

    // If order already has cached results from this session
    if (order.vendors && order.vendors.length > 0) {
      renderVendorResults(order);
      return;
    }

    // Show loading
    vendorPlaceholder.style.display = 'none';
    vendorsList.style.display = 'none';
    orderActionsBar.style.display = 'none';
    vendorLoading.style.display = 'block';
    vendorLoadingText.textContent = `Scanning Dropbox vendor folders for ${order.id}...`;
    orderFoundBadge.textContent = 'Searching...';

    try {
      const vendors = await window.dropboxService.searchOrderVendors(token, order.cleanId);
      order.vendors = vendors;
      renderVendorResults(order);
    } catch (err) {
      console.error('Search error:', err);
      vendorLoading.style.display = 'none';
      vendorPlaceholder.style.display = 'block';
      vendorPlaceholder.innerHTML = `
        <div class="icon">⚠️</div>
        <p style="color: #ff9da4;">Search Error</p>
        <p style="font-size: 10px; margin-top: 4px;">${err.message}</p>
        <button class="btn btn-sm" style="margin-top: 8px;" id="retrySearchBtn">Retry</button>
      `;
      orderFoundBadge.textContent = 'Error';
      const retryBtn = document.getElementById('retrySearchBtn');
      if (retryBtn) retryBtn.addEventListener('click', () => fetchVendorsForOrder(order));
    }
  }

  function renderVendorResults(order) {
    vendorLoading.style.display = 'none';

    if (!order.vendors || order.vendors.length === 0) {
      vendorPlaceholder.style.display = 'block';
      vendorPlaceholder.innerHTML = `
        <div class="icon">🔍</div>
        <p>No vendor files found for ${order.id}</p>
        <p style="font-size: 10px; margin-top: 4px;">Checked /{vendor_name}/${order.id} across Dropbox.</p>
      `;
      vendorsList.style.display = 'none';
      orderActionsBar.style.display = 'none';
      orderFoundBadge.textContent = '0 vendors found';
      return;
    }

    vendorPlaceholder.style.display = 'none';
    vendorsList.style.display = 'flex';
    orderActionsBar.style.display = 'flex';
    orderFoundBadge.textContent = `${order.vendors.length} vendor(s) found`;

    vendorsList.innerHTML = '';
    currentSelectedVendor = order.vendors[0];

    order.vendors.forEach((vendor, vIdx) => {
      const card = document.createElement('div');
      const isSelected = vIdx === 0;
      card.className = `vendor-card ${isSelected ? 'selected' : ''}`;

      const totalSizeFormatted = window.dropboxService.formatBytes(vendor.totalSize);

      card.innerHTML = `
        <div class="vendor-header">
          <div class="vendor-title">
            <span>📁 ${vendor.vendorName}</span>
            <span class="vendor-badge">${vendor.fileCount} files</span>
          </div>
          <div class="vendor-stats">
            <span>${totalSizeFormatted}</span>
            <span class="expand-arrow">▼</span>
          </div>
        </div>
        <div class="vendor-files">
          ${renderFileListHtml(vendor.files)}
        </div>
      `;

      // Header click selects vendor
      const header = card.querySelector('.vendor-header');
      header.addEventListener('click', () => {
        document.querySelectorAll('.vendor-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        currentSelectedVendor = vendor;
      });

      // Individual file open buttons
      const openButtons = card.querySelectorAll('.open-file-btn');
      openButtons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const fileIndex = parseInt(btn.getAttribute('data-file-index'), 10);
          const targetFile = vendor.files[fileIndex];
          if (targetFile) {
            openFileInPhotoshop(order.cleanId, vendor, targetFile);
          }
        });
      });

      vendorsList.appendChild(card);
    });
  }

  function renderFileListHtml(files) {
    if (!files || files.length === 0) {
      return '<div style="font-size: 10px; color: var(--text-muted); padding: 4px;">No files found.</div>';
    }

    return files.map((file, idx) => {
      const sizeStr = window.dropboxService.formatBytes(file.size);
      const extClass = ['psd', 'tif', 'tiff', 'jpg', 'jpeg', 'png'].includes(file.ext) ? file.ext : '';
      return `
        <div class="file-item">
          <div class="file-name" title="${file.name}">
            <span class="file-ext ${extClass}">${file.ext || 'FILE'}</span>
            <span>${file.name}</span>
          </div>
          <div class="file-actions">
            <span style="font-size: 10px; color: var(--text-muted);">${sizeStr}</span>
            <button class="btn btn-sm open-file-btn" data-file-index="${idx}" title="Open in Photoshop">Open</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // File Download & Opening Logic
  async function openFileInPhotoshop(orderId, vendor, file) {
    const token = localStorage.getItem('dropbox_access_token');
    if (!token) {
      setStatus('Error: Dropbox token not set.');
      return;
    }

    try {
      setProgress(5, `Checking cache: ${file.name}`);

      // 1. Check local cache
      let fileEntry = await window.cacheManager.getCachedFile(orderId, file.name, file.size);

      if (fileEntry) {
        setProgress(60, `Cached: ${file.name}`);
      } else {
        // 2. Download from Dropbox API
        setProgress(10, `Downloading ${file.name}...`);
        const buffer = await window.dropboxService.downloadFile(
          token,
          file.pathDisplay,
          (loaded, total) => {
            const pct = Math.round((loaded / total) * 80);
            setProgress(pct, `Downloading ${file.name} (${window.dropboxService.formatBytes(loaded)} / ${window.dropboxService.formatBytes(total)})`);
          }
        );

        // 3. Save to local cache
        setProgress(85, `Caching ${file.name}...`);
        fileEntry = await window.cacheManager.saveFileToCache(orderId, file.name, buffer);
        updateCacheStats();
      }

      // 4. Open in Photoshop
      setProgress(90, `Opening ${file.name} in Photoshop...`);
      await openEntryInPhotoshop(fileEntry);

      setProgress(100, `Opened ${file.name}`);
      setTimeout(() => setProgress(0, `Ready`), 2000);
    } catch (err) {
      console.error('Failed to open file:', err);
      setProgress(0, `Error opening ${file.name}: ${err.message}`);
    }
  }

  async function handleOpenAllFiles() {
    if (!currentSelectedVendor || !currentSelectedVendor.files || currentSelectedVendor.files.length === 0) {
      setStatus('No files to open.');
      return;
    }

    const order = window.orderQueue.getActiveOrder();
    if (!order) return;

    const files = currentSelectedVendor.files;
    const token = localStorage.getItem('dropbox_access_token');
    if (!token) {
      setStatus('Error: Dropbox token not set.');
      return;
    }

    openAllFilesBtn.disabled = true;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const stepNum = i + 1;
        const totalFiles = files.length;

        setProgress(
          Math.round((i / totalFiles) * 100),
          `[${stepNum}/${totalFiles}] Preparing ${file.name}...`
        );

        // Check cache
        let fileEntry = await window.cacheManager.getCachedFile(order.cleanId, file.name, file.size);

        if (!fileEntry) {
          setProgress(
            Math.round((i / totalFiles) * 100),
            `[${stepNum}/${totalFiles}] Downloading ${file.name}...`
          );

          const buffer = await window.dropboxService.downloadFile(
            token,
            file.pathDisplay,
            (loaded, total) => {
              const filePct = total > 0 ? (loaded / total) : 0;
              const overallPct = Math.round(((i + filePct * 0.9) / totalFiles) * 100);
              setProgress(overallPct, `[${stepNum}/${totalFiles}] Downloading ${file.name} (${Math.round(filePct * 100)}%)`);
            }
          );

          fileEntry = await window.cacheManager.saveFileToCache(order.cleanId, file.name, buffer);
        }

        // Open in Photoshop
        setProgress(
          Math.round(((i + 0.95) / totalFiles) * 100),
          `[${stepNum}/${totalFiles}] Opening ${file.name} in Photoshop...`
        );
        await openEntryInPhotoshop(fileEntry);
      }

      updateCacheStats();
      setProgress(100, `All ${files.length} file(s) opened in Photoshop!`);
      setTimeout(() => setProgress(0, 'Ready'), 3000);
    } catch (err) {
      console.error('Batch open error:', err);
      setProgress(0, `Batch error: ${err.message}`);
    } finally {
      openAllFilesBtn.disabled = false;
    }
  }

  /**
   * Safe Photoshop open caller supporting executeAsModal
   */
  async function openEntryInPhotoshop(fileEntry) {
    if (!psApp) {
      console.log('Photoshop app not available, simulated open for:', fileEntry.name);
      return;
    }

    if (psCore && psCore.executeAsModal) {
      await psCore.executeAsModal(
        async () => {
          await psApp.open(fileEntry);
        },
        { commandName: 'Open Dropbox Order File' }
      );
    } else {
      await psApp.open(fileEntry);
    }
  }

  /**
   * Close all active documents in Photoshop
   */
  async function handleCloseAllDocuments() {
    if (!psApp) {
      setStatus('Photoshop DOM not available.');
      return;
    }

    try {
      const docs = psApp.documents;
      if (!docs || docs.length === 0) {
        setStatus('No open documents in Photoshop.');
        return;
      }

      setStatus(`Closing ${docs.length} document(s)...`);

      const closeAction = async () => {
        while (psApp.documents.length > 0) {
          const doc = psApp.documents[psApp.documents.length - 1];
          if (psConstants && psConstants.SaveOptions) {
            await doc.close(psConstants.SaveOptions.DONOTSAVECHANGES);
          } else {
            await doc.close();
          }
        }
      };

      if (psCore && psCore.executeAsModal) {
        await psCore.executeAsModal(closeAction, { commandName: 'Close All Documents' });
      } else {
        await closeAction();
      }

      setStatus('All Photoshop documents closed.');
    } catch (err) {
      console.error('Close documents error:', err);
      setStatus(`Error closing documents: ${err.message}`);
    }
  }

  // Status & Progress Helpers
  function setStatus(msg) {
    statusMessage.textContent = msg;
  }

  function setProgress(pct, msg) {
    if (msg) statusMessage.textContent = msg;
    progressPercent.textContent = pct > 0 ? `${pct}%` : '';
    progressFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }

})();
