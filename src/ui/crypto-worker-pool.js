/**
 * E2EE Crypto Worker Pool
 * Manages multiple worker threads for load balancing and task scheduling
 * Avoids main thread blocking and improves encryption performance
 */
import Worker from './crypto.worker.js?worker';

export class CryptoWorkerPool {
  /**
   * Create worker thread pool
   *
   * @param {number} initialWorkerCount - Initial number of workers (default: 2)
   * @param {number} minWorkers - Minimum workers (default: 2)
   * @param {number} maxWorkers - Maximum workers (default: CPU cores or 8)
   */
  constructor(
    initialWorkerCount = 2,
    minWorkers = 2,
    maxWorkers = navigator.hardwareConcurrency || 8,
  ) {
    this.workers = [];
    this.taskQueue = [];
    this.activeTasksPerWorker = new Map();
    this.taskIdCounter = 0;
    this.maxTasksPerWorker = 5; // Max 5 concurrent tasks per worker

    // Scaling configuration
    this.minWorkers = Math.max(1, minWorkers);
    this.maxWorkers = Math.max(this.minWorkers, maxWorkers);
    this.scaleUpThreshold = 0.8; // Scale up when 80% loaded
    this.scaleDownThreshold = 0.3; // Scale down when below 30% loaded
    this.scaleCheckInterval = 5000; // Check every 5 seconds
    this.idleTimeout = 30000; // Remove idle workers after 30 seconds
    this.lastScaleCheck = Date.now();
    this.workerIdleTime = new Map(); // Track idle time per worker

    // Create initial worker pool
    const initialCount = Math.max(
      this.minWorkers,
      Math.min(initialWorkerCount, this.maxWorkers),
    );
    for (let i = 0; i < initialCount; i++) {
      this.createWorker();
    }

    console.log(
      `✅ Crypto Worker Pool initialized with ${initialCount} workers (min: ${this.minWorkers}, max: ${this.maxWorkers})`,
    );

    // Start periodic scaling check
    this.startScalingMonitor();
  }

  /**
   * Create a new worker
   */
  createWorker() {
    const worker = new Worker();
    this.workers.push(worker);
    this.activeTasksPerWorker.set(worker, 0);
    this.workerIdleTime.set(worker, Date.now());
    worker._activeTasks = new Map();
    worker._workerId = this.workers.length;

    // Listen to worker responses
    worker.onmessage = (event) => {
      this.handleWorkerResponse(worker, event);
    };

    worker.onerror = (error) => {
      console.error(`Worker ${worker._workerId} error:`, error);
    };

    return worker;
  }

  /**
   * Remove a worker from the pool
   */
  removeWorker(worker) {
    if (this.workers.length <= this.minWorkers) {
      return false; // Don't remove if at minimum
    }

    const activeTasks = this.activeTasksPerWorker.get(worker);
    if (activeTasks > 0) {
      return false; // Don't remove if worker is busy
    }

    // Remove worker
    const index = this.workers.indexOf(worker);
    if (index > -1) {
      this.workers.splice(index, 1);
      this.activeTasksPerWorker.delete(worker);
      this.workerIdleTime.delete(worker);
      worker.terminate();
      console.log(
        `🔻 Scaled down: removed worker (now ${this.workers.length} workers)`,
      );
      return true;
    }

    return false;
  }

  /**
   * Start monitoring for auto-scaling
   */
  startScalingMonitor() {
    this.scalingInterval = setInterval(() => {
      this.checkAndScale();
    }, this.scaleCheckInterval);
  }

  /**
   * Check load and scale workers if needed
   */
  checkAndScale() {
    const now = Date.now();
    const status = this.getStatus();
    const avgLoad = status.avgLoad;
    const maxLoad = status.maxLoad;

    // Calculate load ratio (0-1)
    const loadRatio = avgLoad / this.maxTasksPerWorker;

    // Scale up if heavily loaded and below max workers
    if (
      loadRatio > this.scaleUpThreshold &&
      this.workers.length < this.maxWorkers
    ) {
      const newWorker = this.createWorker();
      console.log(
        `🔺 Scaled up: added worker (now ${this.workers.length} workers, load: ${(loadRatio * 100).toFixed(1)}%)`,
      );
      return;
    }

    // Scale down if lightly loaded and above min workers
    if (
      loadRatio < this.scaleDownThreshold &&
      this.workers.length > this.minWorkers
    ) {
      // Find idle workers to remove
      for (const [worker, idleStart] of this.workerIdleTime) {
        const activeTasks = this.activeTasksPerWorker.get(worker);

        if (activeTasks === 0) {
          const idleDuration = now - idleStart;

          // Remove worker if idle for too long
          if (idleDuration > this.idleTimeout) {
            if (this.removeWorker(worker)) {
              break; // Only remove one worker at a time
            }
          }
        }
      }
    }

    // Update idle time tracking
    for (const [worker, activeTasks] of this.activeTasksPerWorker) {
      if (activeTasks === 0) {
        // Worker is idle, track idle time if not already tracked
        if (!this.workerIdleTime.has(worker)) {
          this.workerIdleTime.set(worker, now);
        }
      } else {
        // Worker is busy, reset idle time
        this.workerIdleTime.set(worker, now);
      }
    }
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
    const totalActiveTasks = loads.reduce((a, b) => a + b, 0);
    const avgLoad = loads.length > 0 ? totalActiveTasks / loads.length : 0;

    return {
      workerCount: this.workers.length,
      minWorkers: this.minWorkers,
      maxWorkers: this.maxWorkers,
      queueLength: this.taskQueue.length,
      totalActiveTasks,
      avgLoad,
      maxLoad: loads.length > 0 ? Math.max(...loads) : 0,
      loadRatio: avgLoad / this.maxTasksPerWorker,
    };
  }

  /**
   * Destroy worker pool
   */
  destroy() {
    // Stop scaling monitor
    if (this.scalingInterval) {
      clearInterval(this.scalingInterval);
      this.scalingInterval = null;
    }

    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.taskQueue = [];
    this.activeTasksPerWorker.clear();
    this.workerIdleTime.clear();
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
