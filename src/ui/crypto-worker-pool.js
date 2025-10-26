/**
 * E2EE Crypto Worker Pool
 * 管理多个 Worker 线程，实现负载均衡和任务调度
 * 避免主线程阻塞，提升加密性能
 */

export class CryptoWorkerPool {
  /**
   * 创建 Worker 线程池
   *
   * @param {number} workerCount - Worker 数量（默认为 CPU 核心数）
   */
  constructor(workerCount = navigator.hardwareConcurrency || 4) {
    this.workers = [];
    this.taskQueue = [];
    this.activeTasksPerWorker = new Map();
    this.taskIdCounter = 0;
    this.maxTasksPerWorker = 5; // 每个 Worker 最多同时处理5个任务

    // 创建 Worker 池
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker('./crypto.worker.js', { type: 'module' });
      this.workers.push(worker);
      this.activeTasksPerWorker.set(worker, 0);
      worker._activeTasks = new Map();

      // 监听 Worker 响应
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
   * 提交加密任务到 Worker 池
   *
   * @param {string} type - 任务类型: 'encrypt', 'decrypt', 'derive-key', etc.
   * @param {object} data - 任务数据
   * @returns {Promise} 任务结果
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

      // 选择负载最低的 Worker
      const worker = this.selectWorker();

      if (worker) {
        this.executeTask(worker, task);
      } else {
        // 所有 Worker 繁忙，加入队列
        this.taskQueue.push(task);
      }
    });
  }

  /**
   * 选择负载最低的 Worker
   *
   * @returns {Worker|null} Worker实例或null（所有Worker繁忙）
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

    // 如果所有 Worker 负载过高，返回 null
    return minLoad < this.maxTasksPerWorker ? selectedWorker : null;
  }

  /**
   * 在 Worker 上执行任务
   *
   * @param {Worker} worker - Worker实例
   * @param {object} task - 任务对象
   */
  executeTask(worker, task) {
    // 记录任务
    worker._activeTasks.set(task.taskId, task);

    // 更新负载
    this.activeTasksPerWorker.set(
      worker,
      this.activeTasksPerWorker.get(worker) + 1,
    );

    // 发送任务到 Worker
    worker.postMessage({
      taskId: task.taskId,
      type: task.type,
      data: task.data,
    });
  }

  /**
   * 处理 Worker 响应
   *
   * @param {Worker} worker - Worker实例
   * @param {MessageEvent} event - 消息事件
   */
  handleWorkerResponse(worker, event) {
    const { taskId, success, result, error } = event.data;

    // 获取任务
    const task = worker._activeTasks.get(taskId);
    if (!task) {
      console.warn(`Unknown task ${taskId}`);
      return;
    }

    // 清理任务
    worker._activeTasks.delete(taskId);
    this.activeTasksPerWorker.set(
      worker,
      this.activeTasksPerWorker.get(worker) - 1,
    );

    // 解析结果
    if (success) {
      task.resolve(result);

      // 记录性能指标
      const duration = Date.now() - task.timestamp;
      if (duration > 100) {
        console.warn(`Slow crypto task ${task.type}: ${duration}ms`);
      }
    } else {
      task.reject(new Error(error));
    }

    // 处理队列中的任务
    if (this.taskQueue.length > 0) {
      const nextTask = this.taskQueue.shift();
      this.executeTask(worker, nextTask);
    }
  }

  /**
   * 批量提交任务（并行处理）
   *
   * @param {Array<{type: string, data: object}>} tasks - 任务列表
   * @returns {Promise<Array>} 所有任务的结果
   */
  async submitBatch(tasks) {
    const promises = tasks.map(({ type, data }) => this.submitTask(type, data));
    return Promise.all(promises);
  }

  /**
   * 获取 Worker 池状态
   *
   * @returns {object} 状态信息
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
   * 销毁 Worker 池
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

// 创建全局单例实例（延迟初始化）
let globalCryptoPool = null;

/**
 * 获取全局 Crypto Worker Pool 实例
 *
 * @returns {CryptoWorkerPool}
 */
export function getCryptoPool() {
  if (!globalCryptoPool) {
    globalCryptoPool = new CryptoWorkerPool();
  }
  return globalCryptoPool;
}

// 默认导出
export default CryptoWorkerPool;
