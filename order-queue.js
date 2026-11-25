/**
 * Order Queue Manager
 * Handles multi-order batch parsing, state, navigation, and completion status
 */

class OrderQueue {
  constructor() {
    this.orders = []; // Array of { id, cleanId, status: 'pending'|'active'|'done', vendors: null, error: null }
    this.currentIndex = -1;
    this.listeners = [];
  }

  /**
   * Subscribe to queue changes
   */
  subscribe(fn) {
    if (typeof fn === 'function') {
      this.listeners.push(fn);
    }
  }

  notify() {
    for (const fn of this.listeners) {
      fn(this);
    }
  }

  /**
   * Parse user input text and add valid Order IDs to queue
   * Supports comma, space, newline, semicolon delimiters
   * @param {string} rawText
   * @returns {number} count of newly added orders
   */
  addOrders(rawText) {
    if (!rawText || !rawText.trim()) return 0;

    // Split by comma, semicolon, whitespace, newline
    const tokens = rawText
      .split(/[\s,;\n\r\t]+/)
      .map(t => t.trim())
      .filter(t => t.length > 0);

    let addedCount = 0;
    for (const token of tokens) {
      const cleanId = token.replace(/^#+/, '').trim();
      if (!cleanId) continue;
      const displayId = `#${cleanId}`;

      // Prevent duplicate in current active/pending list
      const exists = this.orders.some(o => o.cleanId.toLowerCase() === cleanId.toLowerCase());
      if (!exists) {
        this.orders.push({
          id: displayId,
          cleanId: cleanId,
          status: 'pending',
          vendors: null,
          selectedVendorIndex: 0,
          error: null
        });
        addedCount++;
      }
    }

    // If no order currently active, activate the first one
    if (this.currentIndex === -1 && this.orders.length > 0) {
      this.setActive(0);
    } else {
      this.notify();
    }

    return addedCount;
  }

  /**
   * Set active order by index
   */
  setActive(index) {
    if (index >= 0 && index < this.orders.length) {
      // If previous order was 'active', keep it or revert to pending if not done
      if (this.currentIndex >= 0 && this.currentIndex < this.orders.length) {
        if (this.orders[this.currentIndex].status === 'active') {
          this.orders[this.currentIndex].status = 'pending';
        }
      }

      this.currentIndex = index;
      if (this.orders[index].status !== 'done') {
        this.orders[index].status = 'active';
      }
      this.notify();
    }
  }

  /**
   * Move to next order in queue
   */
  nextOrder() {
    if (this.hasNext()) {
      this.setActive(this.currentIndex + 1);
    }
  }

  /**
   * Move to previous order in queue
   */
  prevOrder() {
    if (this.hasPrev()) {
      this.setActive(this.currentIndex - 1);
    }
  }

  hasNext() {
    return this.currentIndex >= 0 && this.currentIndex < this.orders.length - 1;
  }

  hasPrev() {
    return this.currentIndex > 0;
  }

  getActiveOrder() {
    if (this.currentIndex >= 0 && this.currentIndex < this.orders.length) {
      return this.orders[this.currentIndex];
    }
    return null;
  }

  /**
   * Remove an order from queue
   */
  removeOrder(index) {
    if (index < 0 || index >= this.orders.length) return;

    this.orders.splice(index, 1);

    if (this.orders.length === 0) {
      this.currentIndex = -1;
    } else if (this.currentIndex === index) {
      // Pick adjacent
      this.currentIndex = Math.min(index, this.orders.length - 1);
      this.orders[this.currentIndex].status = 'active';
    } else if (this.currentIndex > index) {
      this.currentIndex--;
    }

    this.notify();
  }

  /**
   * Mark an order as done
   */
  markDone(index) {
    const targetIdx = index !== undefined ? index : this.currentIndex;
    if (targetIdx >= 0 && targetIdx < this.orders.length) {
      this.orders[targetIdx].status = 'done';
      this.notify();
    }
  }

  /**
   * Clear all finished ('done') orders from queue
   */
  clearDone() {
    const activeOrder = this.getActiveOrder();
    this.orders = this.orders.filter(o => o.status !== 'done');
    
    if (this.orders.length === 0) {
      this.currentIndex = -1;
    } else {
      const newActiveIdx = this.orders.indexOf(activeOrder);
      this.currentIndex = newActiveIdx !== -1 ? newActiveIdx : 0;
      this.orders[this.currentIndex].status = 'active';
    }
    this.notify();
  }

  /**
   * Clear entire queue
   */
  clearAll() {
    this.orders = [];
    this.currentIndex = -1;
    this.notify();
  }
}

// Export instance
window.orderQueue = new OrderQueue();
