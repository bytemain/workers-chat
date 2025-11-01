/**
 * E2EE Crypto Worker Pool
 * Manages multiple worker threads for load balancing and task scheduling
 * Avoids main thread blocking and improves encryption performance
 */

export class CryptoWorkerPool {
  /**
   * Create worker thread pool
   *
   * @param {number} workerCount - Number of workers (defaults to CPU core count)
   */
  constructor(workerCount = navigator.hardwareConcurrency || 4) {
    this.workers = [];
    this.taskQueue = [];
    this.activeTasksPerWorker = new Map();
    this.taskIdCounter = 0;
    this.maxTasksPerWorker = 5; // Max 5 concurrent tasks per worker

    // Create worker pool
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker('./crypto.worker.js', { type: 'module' });
      this.workers.push(worker);
      this.activeTasksPerWorker.set(worker, 0);
      worker._activeTasks = new Map();

      // Listen to worker responses
      worker.onmessage = (event) => {
        this.handleWorkerResponse(worker, event);
      };

      worker.onerror = (error) => {
        console.error(`Worker ${i} error:`, error);
      };
    }

    console.log(
      `✅ Crypto Worker Pool initialized with ${workerCount} workers`,
    );
  }

  /**
   * Submit encryption task to worker pool
   *
   * @param {string} type - Task type: 'encrypt', 'decrypt', 'derive-key', etc.
   * @param {object} data - Task data
   * @returns {Promise} Task result
   */
  async submitTask(type, data) {
    return new Promise((resolve, reject) => {
      const taskId = this.taskIdCounter++;
      const task = {
        taskId,
        type,
        data,
        resolve,
        reject,
        timestamp: Date.now(),
      };

      // Select worker with lowest load
      const worker = this.selectWorker();

      if (worker) {
        this.executeTask(worker, task);
      } else {
        // All workers busy, add to queue
        this.taskQueue.push(task);
      }
    });
  }

  /**
   * Select worker with lowest load
   *
   * @returns {Worker|null} Worker instance or null (all workers busy)
   */
  selectWorker() {
    let minLoad = Infinity;
    let selectedWorker = null;

    for (const [worker, load] of this.activeTasksPerWorker) {
      if (load < minLoad) {
        minLoad = load;
        selectedWorker = worker;
      }
    }

    // If all workers have high load, return null
    return minLoad < this.maxTasksPerWorker ? selectedWorker : null;
  }

  /**
   * Execute task on worker
   *
   * @param {Worker} worker - Worker instance
   * @param {object} task - Task object
   */
  executeTask(worker, task) {
    // Record task
    worker._activeTasks.set(task.taskId, task);

    // Update load
    this.activeTasksPerWorker.set(
      worker,
      this.activeTasksPerWorker.get(worker) + 1,
    );

    // Send task to worker
    worker.postMessage({
      taskId: task.taskId,
      type: task.type,
      data: task.data,
    });
  }

  /**
   * Handle worker response
   *
   * @param {Worker} worker - Worker instance
   * @param {MessageEvent} event - Message event
   */
  handleWorkerResponse(worker, event) {
    const { taskId, success, result, error } = event.data;

    // Get task
    const task = worker._activeTasks.get(taskId);
    if (!task) {
      console.warn(`Unknown task ${taskId}`);
      return;
    }

    // Clean up task
    worker._activeTasks.delete(taskId);
    this.activeTasksPerWorker.set(
      worker,
      this.activeTasksPerWorker.get(worker) - 1,
    );

    // Resolve result
    if (success) {
      task.resolve(result);

      // Log performance metrics
      const duration = Date.now() - task.timestamp;
      if (duration > 100) {
        console.warn(`Slow crypto task ${task.type}: ${duration}ms`);
      }
    } else {
      task.reject(new Error(error));
    }

    // Process queued tasks
    if (this.taskQueue.length > 0) {
      const nextTask = this.taskQueue.shift();
      this.executeTask(worker, nextTask);
    }
  }

  /**
   * Submit batch tasks (parallel processing)
   *
   * @param {Array<{type: string, data: object}>} tasks - Task list
   * @returns {Promise<Array>} Results of all tasks
   */
  async submitBatch(tasks) {
    const promises = tasks.map(({ type, data }) => this.submitTask(type, data));
    return Promise.all(promises);
  }

  /**
   * Get worker pool status
   *
   * @returns {object} Status information
   */
  getStatus() {
    const loads = Array.from(this.activeTasksPerWorker.values());
    return {
      workerCount: this.workers.length,
      queueLength: this.taskQueue.length,
      totalActiveTasks: loads.reduce((a, b) => a + b, 0),
      avgLoad: loads.reduce((a, b) => a + b, 0) / loads.length,
      maxLoad: Math.max(...loads),
    };
  }

  /**
   * Destroy worker pool
   */
  destroy() {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.taskQueue = [];
    this.activeTasksPerWorker.clear();
    console.log('🔥 Crypto Worker Pool destroyed');
  }
}

// Create global singleton instance (lazy initialization)
let globalCryptoPool = null;

/**
 * Get global Crypto Worker Pool instance
 *
 * @returns {CryptoWorkerPool}
 */
export function getCryptoPool() {
  if (!globalCryptoPool) {
    globalCryptoPool = new CryptoWorkerPool();
  }
  return globalCryptoPool;
}

// Default export
export default CryptoWorkerPool;
