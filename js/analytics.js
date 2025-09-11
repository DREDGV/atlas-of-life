// js/analytics.js
// Advanced Analytics Dashboard for Atlas of Life

import { logEvent, getLogs } from './utils/analytics.js';
import { state } from './state.js';

class AnalyticsDashboard {
  constructor() {
    this.charts = new Map();
    this.filters = {
      timeRange: 'week', // day, week, month, year
      domain: 'all',
      status: 'all'
    };
  }

  // Calculate comprehensive statistics
  calculateStats() {
    const tasks = state.tasks || [];
    const projects = state.projects || [];
    const domains = state.domains || [];
    
    // Basic counts
    const stats = {
      total: {
        tasks: tasks.length,
        projects: projects.length,
        domains: domains.length
      },
      byStatus: {
        backlog: tasks.filter(t => t.status === 'backlog').length,
        today: tasks.filter(t => t.status === 'today').length,
        doing: tasks.filter(t => t.status === 'doing').length,
        done: tasks.filter(t => t.status === 'done').length
      },
      byDomain: {},
      byProject: {},
      timeMetrics: this.calculateTimeMetrics(tasks),
      productivity: this.calculateProductivity(tasks)
    };

    // Group by domain
    domains.forEach(domain => {
      const domainTasks = tasks.filter(t => 
        t.domainId === domain.id || 
        (t.projectId && projects.find(p => p.id === t.projectId && p.domainId === domain.id))
      );
      stats.byDomain[domain.title] = {
        total: domainTasks.length,
        backlog: domainTasks.filter(t => t.status === 'backlog').length,
        today: domainTasks.filter(t => t.status === 'today').length,
        doing: domainTasks.filter(t => t.status === 'doing').length,
        done: domainTasks.filter(t => t.status === 'done').length
      };
    });

    // Group by project
    projects.forEach(project => {
      const projectTasks = tasks.filter(t => t.projectId === project.id);
      stats.byProject[project.title] = {
        total: projectTasks.length,
        backlog: projectTasks.filter(t => t.status === 'backlog').length,
        today: projectTasks.filter(t => t.status === 'today').length,
        doing: projectTasks.filter(t => t.status === 'doing').length,
        done: projectTasks.filter(t => t.status === 'done').length
      };
    });

    return stats;
  }

  // Calculate time-based metrics
  calculateTimeMetrics(tasks) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    return {
      avgCompletionTime: this.calculateAvgCompletionTime(tasks),
      overdueTasks: tasks.filter(t => t.due && new Date(t.due).getTime() < now).length,
      completedToday: tasks.filter(t => 
        t.status === 'done' && 
        t.updatedAt && 
        (now - t.updatedAt) < dayMs
      ).length,
      createdToday: tasks.filter(t => 
        t.createdAt && 
        (now - t.createdAt) < dayMs
      ).length
    };
  }

  // Calculate average completion time
  calculateAvgCompletionTime(tasks) {
    const completedTasks = tasks.filter(t => 
      t.status === 'done' && t.createdAt && t.updatedAt
    );
    
    if (completedTasks.length === 0) return 0;
    
    const totalTime = completedTasks.reduce((sum, task) => {
      return sum + (task.updatedAt - task.createdAt);
    }, 0);
    
    return Math.round(totalTime / completedTasks.length / (24 * 60 * 60 * 1000)); // days
  }

  // Calculate productivity metrics
  calculateProductivity(tasks) {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    
    const recentTasks = tasks.filter(t => 
      t.createdAt && (now - t.createdAt) < weekMs
    );
    
    const completedThisWeek = tasks.filter(t => 
      t.status === 'done' && 
      t.updatedAt && 
      (now - t.updatedAt) < weekMs
    );
    
    return {
      tasksThisWeek: recentTasks.length,
      completedThisWeek: completedThisWeek.length,
      completionRate: recentTasks.length > 0 ? 
        Math.round((completedThisWeek.length / recentTasks.length) * 100) : 0,
      activeTasks: tasks.filter(t => t.status === 'doing' || t.status === 'today').length
    };
  }

  // Generate chart data
  generateChartData(type) {
    const stats = this.calculateStats();
    
    switch (type) {
      case 'status':
        return {
          labels: ['План', 'Сегодня', 'В работе', 'Готово'],
          data: [
            stats.byStatus.backlog,
            stats.byStatus.today,
            stats.byStatus.doing,
            stats.byStatus.done
          ],
          colors: ['#9db1c9', '#f2c94c', '#56ccf2', '#19c37d']
        };
      
      case 'domains':
        const domainLabels = Object.keys(stats.byDomain);
        const domainData = domainLabels.map(domain => stats.byDomain[domain].total);
        return {
          labels: domainLabels,
          data: domainData,
          colors: this.generateColors(domainLabels.length)
        };
      
      case 'productivity':
        const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
        const productivityData = this.getWeeklyProductivity();
        return {
          labels: days,
          data: productivityData,
          colors: ['#56ccf2']
        };
      
      default:
        return { labels: [], data: [], colors: [] };
    }
  }

  // Get weekly productivity data (mock for now)
  getWeeklyProductivity() {
    // In a real implementation, this would analyze task completion over time
    return [3, 5, 2, 7, 4, 1, 2]; // Mock data
  }

  // Generate colors for charts
  generateColors(count) {
    const colors = [
      '#56ccf2', '#19c37d', '#f2c94c', '#ff6b6b', 
      '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57'
    ];
    return colors.slice(0, count);
  }

  // Render analytics dashboard
  renderDashboard() {
    const stats = this.calculateStats();
    
    return `
      <div class="analytics-dashboard" style="padding: 20px; max-width: 1200px; margin: 0 auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="color: var(--text); margin: 0;">📊 Аналитика и статистика</h2>
          <div style="display: flex; gap: 10px;">
            <select id="timeRangeFilter" style="padding: 6px 12px; background: var(--panel-1); border: 1px solid var(--panel-2); border-radius: 6px; color: var(--text);">
              <option value="day">День</option>
              <option value="week" selected>Неделя</option>
              <option value="month">Месяц</option>
              <option value="year">Год</option>
            </select>
            <button onclick="window.analyticsDashboard.exportData()" style="padding: 6px 12px; background: var(--accent); color: white; border: none; border-radius: 6px; cursor: pointer;">
              📤 Экспорт
            </button>
          </div>
        </div>

        <!-- Key Metrics -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px;">
          <div class="metric-card" style="background: var(--panel-1); border: 1px solid var(--panel-2); border-radius: 8px; padding: 16px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold; color: var(--accent);">${stats.total.tasks}</div>
            <div style="font-size: 12px; color: var(--muted);">Всего задач</div>
          </div>
          <div class="metric-card" style="background: var(--panel-1); border: 1px solid var(--panel-2); border-radius: 8px; padding: 16px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold; color: var(--ok);">${stats.timeMetrics.completedToday}</div>
            <div style="font-size: 12px; color: var(--muted);">Завершено сегодня</div>
          </div>
          <div class="metric-card" style="background: var(--panel-1); border: 1px solid var(--panel-2); border-radius: 8px; padding: 16px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold; color: var(--warn);">${stats.timeMetrics.overdueTasks}</div>
            <div style="font-size: 12px; color: var(--muted);">Просрочено</div>
          </div>
          <div class="metric-card" style="background: var(--panel-1); border: 1px solid var(--panel-2); border-radius: 8px; padding: 16px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold; color: var(--accent);">${stats.productivity.completionRate}%</div>
            <div style="font-size: 12px; color: var(--muted);">Процент выполнения</div>
          </div>
        </div>

        <!-- Charts Section -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
          <!-- Status Distribution -->
          <div class="chart-container" style="background: var(--panel-1); border: 1px solid var(--panel-2); border-radius: 8px; padding: 16px;">
            <h3 style="color: var(--text); margin: 0 0 16px 0; font-size: 16px;">Распределение по статусам</h3>
            <div id="statusChart" style="height: 200px; display: flex; align-items: center; justify-content: center;">
              ${this.renderStatusChart()}
            </div>
          </div>

          <!-- Domain Distribution -->
          <div class="chart-container" style="background: var(--panel-1); border: 1px solid var(--panel-2); border-radius: 8px; padding: 16px;">
            <h3 style="color: var(--text); margin: 0 0 16px 0; font-size: 16px;">Задачи по доменам</h3>
            <div id="domainChart" style="height: 200px; display: flex; align-items: center; justify-content: center;">
              ${this.renderDomainChart()}
            </div>
          </div>
        </div>

        <!-- Detailed Tables -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
          <!-- Domain Details -->
          <div style="background: var(--panel-1); border: 1px solid var(--panel-2); border-radius: 8px; padding: 16px;">
            <h3 style="color: var(--text); margin: 0 0 16px 0; font-size: 16px;">Детали по доменам</h3>
            <div style="max-height: 300px; overflow-y: auto;">
              ${this.renderDomainTable()}
            </div>
          </div>

          <!-- Project Details -->
          <div style="background: var(--panel-1); border: 1px solid var(--panel-2); border-radius: 8px; padding: 16px;">
            <h3 style="color: var(--text); margin: 0 0 16px 0; font-size: 16px;">Детали по проектам</h3>
            <div style="max-height: 300px; overflow-y: auto;">
              ${this.renderProjectTable()}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Render status chart (simple bar chart)
  renderStatusChart() {
    const chartData = this.generateChartData('status');
    const maxValue = Math.max(...chartData.data);
    
    return `
      <div style="display: flex; align-items: end; gap: 8px; height: 100%; width: 100%;">
        ${chartData.data.map((value, index) => `
          <div style="display: flex; flex-direction: column; align-items: center; flex: 1;">
            <div style="
              background: ${chartData.colors[index]}; 
              height: ${(value / maxValue) * 150}px; 
              width: 100%; 
              border-radius: 4px 4px 0 0;
              margin-bottom: 8px;
            "></div>
            <div style="font-size: 10px; color: var(--muted); text-align: center;">${chartData.labels[index]}</div>
            <div style="font-size: 12px; font-weight: bold; color: var(--text);">${value}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Render domain chart (simple bar chart)
  renderDomainChart() {
    const chartData = this.generateChartData('domains');
    if (chartData.data.length === 0) {
      return '<div style="color: var(--muted); text-align: center;">Нет данных</div>';
    }
    
    const maxValue = Math.max(...chartData.data);
    
    return `
      <div style="display: flex; align-items: end; gap: 4px; height: 100%; width: 100%;">
        ${chartData.data.map((value, index) => `
          <div style="display: flex; flex-direction: column; align-items: center; flex: 1;">
            <div style="
              background: ${chartData.colors[index]}; 
              height: ${(value / maxValue) * 150}px; 
              width: 100%; 
              border-radius: 4px 4px 0 0;
              margin-bottom: 8px;
            "></div>
            <div style="font-size: 9px; color: var(--muted); text-align: center; word-break: break-word;">${chartData.labels[index]}</div>
            <div style="font-size: 11px; font-weight: bold; color: var(--text);">${value}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Render domain table
  renderDomainTable() {
    const stats = this.calculateStats();
    const domains = Object.keys(stats.byDomain);
    
    if (domains.length === 0) {
      return '<div style="color: var(--muted); text-align: center; padding: 20px;">Нет доменов</div>';
    }
    
    return `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid var(--panel-2);">
            <th style="text-align: left; padding: 8px; font-size: 12px; color: var(--muted);">Домен</th>
            <th style="text-align: center; padding: 8px; font-size: 12px; color: var(--muted);">Всего</th>
            <th style="text-align: center; padding: 8px; font-size: 12px; color: var(--muted);">Готово</th>
          </tr>
        </thead>
        <tbody>
          ${domains.map(domain => {
            const domainStats = stats.byDomain[domain];
            const completionRate = domainStats.total > 0 ? 
              Math.round((domainStats.done / domainStats.total) * 100) : 0;
            return `
              <tr style="border-bottom: 1px solid var(--panel-2);">
                <td style="padding: 8px; font-size: 12px; color: var(--text);">${domain}</td>
                <td style="text-align: center; padding: 8px; font-size: 12px; color: var(--text);">${domainStats.total}</td>
                <td style="text-align: center; padding: 8px; font-size: 12px; color: var(--ok);">${domainStats.done} (${completionRate}%)</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  // Render project table
  renderProjectTable() {
    const stats = this.calculateStats();
    const projects = Object.keys(stats.byProject);
    
    if (projects.length === 0) {
      return '<div style="color: var(--muted); text-align: center; padding: 20px;">Нет проектов</div>';
    }
    
    return `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid var(--panel-2);">
            <th style="text-align: left; padding: 8px; font-size: 12px; color: var(--muted);">Проект</th>
            <th style="text-align: center; padding: 8px; font-size: 12px; color: var(--muted);">Всего</th>
            <th style="text-align: center; padding: 8px; font-size: 12px; color: var(--muted);">Готово</th>
          </tr>
        </thead>
        <tbody>
          ${projects.map(project => {
            const projectStats = stats.byProject[project];
            const completionRate = projectStats.total > 0 ? 
              Math.round((projectStats.done / projectStats.total) * 100) : 0;
            return `
              <tr style="border-bottom: 1px solid var(--panel-2);">
                <td style="padding: 8px; font-size: 12px; color: var(--text);">${project}</td>
                <td style="text-align: center; padding: 8px; font-size: 12px; color: var(--text);">${projectStats.total}</td>
                <td style="text-align: center; padding: 8px; font-size: 12px; color: var(--ok);">${projectStats.done} (${completionRate}%)</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  // Export analytics data
  exportData() {
    const stats = this.calculateStats();
    const data = {
      timestamp: new Date().toISOString(),
      statistics: stats,
      filters: this.filters
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atlas-analytics-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    logEvent('analytics_export', { timestamp: Date.now() });
  }

  // Open analytics modal
  openModal() {
    const bodyHTML = this.renderDashboard();
    
    // Use global openModal function
    if (typeof window.openModal === 'function') {
      window.openModal({
        title: '📊 Аналитика и статистика',
        bodyHTML: bodyHTML,
        confirmText: 'Закрыть',
        onConfirm: () => {
          // Clean up any event listeners if needed
        }
      });
    } else {
      console.error('openModal function not available');
    }
  }
}

// Export for global access
export { AnalyticsDashboard };

// Create and export instance for convenience
export const analyticsDashboard = new AnalyticsDashboard();
