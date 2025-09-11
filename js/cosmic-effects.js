// js/cosmic-effects.js
// Cosmic Effects System for Atlas of Life

class ParticleSystem {
  constructor() {
    this.particles = [];
    this.maxParticles = 100; // Reduced for better performance
    this.canvas = null;
    this.ctx = null;
  }

  // Initialize particle system
  init(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
  }

  // Create particle explosion effect
  createExplosion(x, y, color = '#ff6b6b', count = 25) {
    // Enhanced validation with better error reporting
    if (x === undefined || y === undefined) {
      console.warn('Invalid explosion coordinates: undefined values', { x, y, color, count });
      return;
    }
    if (!isFinite(x) || !isFinite(y)) {
      console.warn('Invalid explosion coordinates: non-finite values', { x, y, color, count });
      return;
    }
    
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.8;
      const speed = 3 + Math.random() * 6; // Увеличили скорость
      const life = 80 + Math.random() * 60; // Увеличили время жизни
      
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: life,
        maxLife: life,
        color: color,
        size: 3 + Math.random() * 5, // Увеличили размер
        gravity: 0.15, // Увеличили гравитацию
        fade: true,
        glow: true, // Добавили свечение
        explosion: true // Маркер для взрыва
      });
    }
  }

  // Create star dust effect for task creation
  createStarDust(x, y, color = '#60a5fa', count = 20) {
    // Validate input parameters
    if (!isFinite(x) || !isFinite(y)) {
      console.warn('Invalid star dust coordinates:', x, y);
      return;
    }
    
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4; // Увеличили скорость
      const life = 60 + Math.random() * 40; // Увеличили время жизни
      
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: life,
        maxLife: life,
        color: color,
        size: 2 + Math.random() * 4, // Увеличили размер
        gravity: 0.02, // Уменьшили гравитацию
        fade: true,
        twinkle: true,
        glow: true // Добавили свечение
      });
    }
  }

  // Create energy flow effect between connected elements
  createEnergyFlow(startX, startY, endX, endY, color = '#00ffff') {
    // Validate input parameters
    if (!isFinite(startX) || !isFinite(startY) || !isFinite(endX) || !isFinite(endY)) {
      console.warn('Invalid energy flow coordinates:', startX, startY, endX, endY);
      return;
    }
    
    const distance = Math.hypot(endX - startX, endY - startY);
    const particleCount = Math.floor(distance / 20);
    
    for (let i = 0; i < particleCount; i++) {
      const t = i / particleCount;
      const x = startX + (endX - startX) * t;
      const y = startY + (endY - startY) * t;
      
      this.particles.push({
        x: x,
        y: y,
        vx: (endX - startX) / distance * 2,
        vy: (endY - startY) / distance * 2,
        life: 20 + Math.random() * 10,
        maxLife: 30,
        color: color,
        size: 1 + Math.random() * 1.5,
        gravity: 0,
        fade: true,
        energy: true
      });
    }
  }

  // Create cosmic pulse effect
  createCosmicPulse(x, y, color = '#ff6b6b', radius = 50) {
    const count = 20;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const distance = radius + Math.random() * 20;
      const targetX = x + Math.cos(angle) * distance;
      const targetY = y + Math.sin(angle) * distance;
      
      this.particles.push({
        x: x,
        y: y,
        targetX: targetX,
        targetY: targetY,
        vx: 0,
        vy: 0,
        life: 40 + Math.random() * 20,
        maxLife: 60,
        color: color,
        size: 2 + Math.random() * 2,
        gravity: 0,
        fade: true,
        pulse: true
      });
    }
  }

  // Update all particles
  update() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      
      // Update position
      p.x += p.vx;
      p.y += p.vy;
      
      // Apply gravity
      if (p.gravity > 0) {
        p.vy += p.gravity;
      }
      
      // Handle pulse particles
      if (p.pulse && p.targetX !== undefined) {
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const distance = Math.hypot(dx, dy);
        
        if (distance > 1) {
          p.vx = dx * 0.1;
          p.vy = dy * 0.1;
        } else {
          p.vx *= 0.9;
          p.vy *= 0.9;
        }
      }
      
      // Decrease life
      p.life--;
      
      // Remove dead particles
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  // Render all particles
  render() {
    if (!this.ctx) return;
    
    this.ctx.save();
    
    this.particles.forEach(p => {
      const alpha = p.fade ? p.life / p.maxLife : 1;
      this.ctx.globalAlpha = alpha;
      
      // Twinkling effect
      if (p.twinkle) {
        const twinkle = 0.5 + 0.5 * Math.sin(performance.now() * 0.01 + p.x * 0.1);
        this.ctx.globalAlpha *= twinkle;
      }
      
      // Energy particles have special rendering
      if (p.energy) {
        this.ctx.strokeStyle = p.color;
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(p.x - p.vx * 8, p.y - p.vy * 8);
        this.ctx.lineTo(p.x, p.y);
        this.ctx.stroke();
        
        // Add energy glow
        this.ctx.strokeStyle = p.color + '40';
        this.ctx.lineWidth = 6;
        this.ctx.beginPath();
        this.ctx.moveTo(p.x - p.vx * 8, p.y - p.vy * 8);
        this.ctx.lineTo(p.x, p.y);
        this.ctx.stroke();
      } else {
        // Check for valid particle values
        if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.size) || p.size <= 0) {
          return; // Skip invalid particles
        }
        
        // Enhanced particle rendering with better glow
        if (p.glow) {
          // Outer glow
          const outerGradient = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
          outerGradient.addColorStop(0, p.color + '20');
          outerGradient.addColorStop(0.5, p.color + '10');
          outerGradient.addColorStop(1, 'transparent');
          
          this.ctx.fillStyle = outerGradient;
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
          this.ctx.fill();
          
          // Inner glow
          const innerGradient = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
          innerGradient.addColorStop(0, p.color + '80');
          innerGradient.addColorStop(0.7, p.color + '40');
          innerGradient.addColorStop(1, 'transparent');
          
          this.ctx.fillStyle = innerGradient;
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
          this.ctx.fill();
        }
        
        // Core particle
        this.ctx.fillStyle = p.color;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.ctx.fill();
        
        // Bright center for explosion particles
        if (p.explosion) {
          this.ctx.fillStyle = '#ffffff';
          this.ctx.globalAlpha = alpha * 0.8;
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, p.size * 0.3, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.globalAlpha = alpha;
        }
      }
    });
    
    this.ctx.restore();
  }

  // Clear all particles
  clear() {
    this.particles = [];
  }
}

class CosmicAnimations extends ParticleSystem {
  constructor() {
    super();
    this.animations = new Map();
    this.soundEnabled = true; // Enable sounds by default
  }

  // Initialize cosmic effects
  init(canvas, ctx) {
    super.init(canvas, ctx);
    this.setupSoundSystem();
  }

  // Setup sound system (Web Audio API)
  setupSoundSystem() {
    // Initialize sound system for all browsers
    
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.soundEnabled = true;
    } catch (e) {
      console.warn('Web Audio API not supported, sounds disabled');
      this.soundEnabled = false;
    }
  }

  // Play cosmic sound effect
  playSound(type, frequency = 440, duration = 0.2) {
    if (!this.soundEnabled || !this.audioContext) return;
    
    try {
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      // Different sound types
      switch (type) {
        case 'create':
          oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
          oscillator.type = 'sine';
          break;
        case 'delete':
          oscillator.frequency.setValueAtTime(frequency * 0.5, this.audioContext.currentTime);
          oscillator.type = 'sawtooth';
          break;
        case 'pulse':
          oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(frequency * 2, this.audioContext.currentTime + duration);
          oscillator.type = 'triangle';
          break;
        case 'flow':
          oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
          oscillator.frequency.linearRampToValueAtTime(frequency * 1.5, this.audioContext.currentTime + duration);
          oscillator.type = 'sine';
          break;
      }
      
      // Enhanced envelope for better audibility
      gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, this.audioContext.currentTime + 0.01); // Louder
      gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);
      
      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + duration);
    } catch (e) {
      console.warn('Sound playback failed:', e);
    }
  }

  // Animate task creation
  animateTaskCreation(x, y, status) {
    const colors = {
      'done': '#10b981',
      'today': '#f59e0b',
      'doing': '#60a5fa',
      'backlog': '#9ca3af'
    };
    
    const color = colors[status] || colors['backlog'];
    
    // Create star dust effect
    this.createStarDust(x, y, color, 12);
    
    // Play creation sound - more pleasant and noticeable
    this.playSound('create', 880, 0.4);
    
    // Add cosmic pulse
    setTimeout(() => {
      this.createCosmicPulse(x, y, color, 30);
    }, 100);
  }

  // Animate task deletion
  animateTaskDeletion(x, y, status) {
    const colors = {
      'done': '#10b981',
      'today': '#f59e0b',
      'doing': '#60a5fa',
      'backlog': '#9ca3af'
    };
    
    const color = colors[status] || colors['backlog'];
    
    // Create explosion effect
    this.createExplosion(x, y, color, 20);
    
    // Play deletion sound - more dramatic
    this.playSound('delete', 180, 0.6);
  }

  // Animate status change
  animateStatusChange(x, y, oldStatus, newStatus) {
    const colors = {
      'done': '#10b981',
      'today': '#f59e0b',
      'doing': '#60a5fa',
      'backlog': '#9ca3af'
    };
    
    const color = colors[newStatus] || colors['backlog'];
    
    // Create energy flow effect
    this.createEnergyFlow(x - 20, y, x + 20, y, color);
    
    // Play pulse sound
    this.playSound('pulse', 440, 0.2);
  }

  // Animate connection between elements
  animateConnection(startX, startY, endX, endY, type = 'project') {
    const colors = {
      'project': '#a78bfa',
      'domain': '#f472b6',
      'task': '#60a5fa'
    };
    
    const color = colors[type] || colors['task'];
    
    // Create energy flow
    this.createEnergyFlow(startX, startY, endX, endY, color);
    
    // Play flow sound
    this.playSound('flow', 330, 0.3);
  }

  // Animate domain focus
  animateDomainFocus(x, y, color) {
    // Create multiple cosmic pulses
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        this.createCosmicPulse(x, y, color, 40 + i * 20);
      }, i * 200);
    }
    
    // Play focus sound
    this.playSound('pulse', 550, 0.5);
  }

  // Animate domain pulse (for domain deletion)
  animateDomainPulse(x, y, radius, color) {
    // Validate input parameters
    if (!isFinite(x) || !isFinite(y) || !isFinite(radius)) {
      console.warn('Invalid domain pulse coordinates:', x, y, radius);
      return;
    }
    
    // Create multiple explosion effects around the domain
    for (let i = 0; i < 5; i++) {
      const angle = (Math.PI * 2 * i) / 5;
      const offsetX = x + Math.cos(angle) * radius * 0.8;
      const offsetY = y + Math.sin(angle) * radius * 0.8;
      
      setTimeout(() => {
        this.createExplosion(offsetX, offsetY, color, 15);
      }, i * 100);
    }
    
    // Create central explosion
    setTimeout(() => {
      this.createExplosion(x, y, color, 25);
    }, 300);
    
    // Play deletion sound - more dramatic for domain deletion
    this.playSound('delete', 150, 0.8);
  }

  // Update all animations
  update() {
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity || 0;
      p.life--;
      
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  // Render all effects
  render() {
    if (!this.ctx) return;
    
    this.ctx.save();
    this.particles.forEach(p => {
      if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.size) || p.size <= 0) {
        return;
      }
      
      const alpha = p.life / p.maxLife;
      this.ctx.globalAlpha = alpha;
      this.ctx.fillStyle = p.color;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fill();
    });
    this.ctx.restore();
  }

  // Clear all effects
  clear() {
    this.particles = [];
  }
}

// Export for global access
export { ParticleSystem, CosmicAnimations };
