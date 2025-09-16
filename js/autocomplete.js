// Enhanced autocomplete system for quick input
// Supports tags, projects, domains, and smart suggestions

import { state } from './state.js';

class AutocompleteSystem {
  constructor() {
    this.popup = null;
    this.dim = null;
    this.items = [];
    this.selectedIndex = -1;
    this.lastTrigger = null;
    this.isVisible = false;

    this.input = document.getElementById('quickAdd');
    if (!this.input) {
      return;
    }

    this.init();
  }
  
  init() {
    this.createElements();
    this.attachEvents();
  }
  
  createElements() {
    // Create popup container
    this.popup = document.createElement('div');
    this.popup.className = 'autocomplete-popup';
    this.popup.style.cssText = `
      position: absolute;
      background: var(--panel-1) !important;
      border: 1px solid var(--panel-2) !important;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important;
      z-index: 1000;
      max-height: 200px;
      overflow-y: auto;
      display: none;
      min-width: 250px;
      opacity: 1 !important;
      visibility: visible !important;
    `;
    
    // Create dim overlay
    this.dim = document.createElement('div');
    this.dim.className = 'autocomplete-dim';
    this.dim.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: transparent;
      z-index: 999;
      display: none;
    `;
    
    document.body.appendChild(this.dim);
    document.body.appendChild(this.popup);
    
    console.log('Autocomplete: popup element created and added to DOM:', this.popup);
    console.log('Autocomplete: popup parent:', this.popup.parentElement);
  }
  
  attachEvents() {
    // Find quick input field
    this.input = document.getElementById('quickAdd');
    if (!this.input) {
      console.warn('Autocomplete: quickAdd input not found');
      return;
    }
    
    console.log('Autocomplete: initialized for input', this.input);
    
    this.input.addEventListener('input', (e) => this.handleInput(e));
    this.input.addEventListener('keydown', (e) => this.handleKeydown(e));
    this.input.addEventListener('blur', () => this.hide());
    
    // Click outside to close
    this.dim.addEventListener('click', () => this.hide());
  }
  
  handleInput(e) {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    
    // Find trigger position
    const trigger = this.findTrigger(value, cursorPos);
    
    if (trigger) {
      this.showSuggestions(trigger, e.target);
    } else {
      this.hide();
    }
  }
  
  handleKeydown(e) {
    if (!this.isVisible) return;
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.selectNext();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.selectPrevious();
        break;
      case 'Enter':
        e.preventDefault();
        this.selectCurrent();
        break;
      case 'Escape':
        e.preventDefault();
        this.hide();
        break;
      case 'Tab':
        if (this.selectedIndex >= 0) {
          e.preventDefault();
          this.selectCurrent();
        }
        break;
    }
  }
  
  findTrigger(text, cursorPos) {
    // Look for #tag, @project, ##domain patterns
    const patterns = [
      { regex: /#([^#\s]*)$/, type: 'tag', prefix: '#' },
      { regex: /@([^@\s]*)$/, type: 'project', prefix: '@' },
      { regex: /##([^#\s]*)$/, type: 'domain', prefix: '##' }
    ];
    
    const beforeCursor = text.substring(0, cursorPos);
    console.log('Autocomplete: checking text:', beforeCursor, 'at pos:', cursorPos);
    
    for (const pattern of patterns) {
      const match = beforeCursor.match(pattern.regex);
      if (match) {
        console.log('Autocomplete: found trigger:', pattern.type, 'query:', match[1]);
        return {
          type: pattern.type,
          prefix: pattern.prefix,
          query: match[1],
          start: match.index,
          end: cursorPos
        };
      }
    }
    
    return null;
  }
  
  showSuggestions(trigger, inputElement) {
    const suggestions = this.getSuggestions(trigger.type, trigger.query);
    
    console.log('Autocomplete: got suggestions:', suggestions);
    
    if (suggestions.length === 0) {
      console.log('Autocomplete: no suggestions, hiding');
      this.hide();
      return;
    }
    
    this.items = suggestions;
    this.selectedIndex = 0;
    this.lastTrigger = trigger;
    
    // Position popup - smart positioning
    const rect = inputElement.getBoundingClientRect();
    const popupHeight = 200; // max-height from CSS
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    
    let topPosition;
    let useFixedPosition = false;
    
    if (spaceBelow >= popupHeight + 10) {
      // Show below input if there's enough space
      topPosition = rect.bottom + 4;
    } else if (spaceAbove >= popupHeight + 10) {
      // Show above input if there's enough space above
      topPosition = rect.top - popupHeight - 4;
    } else {
      // Not enough space above or below, use fixed positioning
      useFixedPosition = true;
      topPosition = Math.max(10, window.innerHeight - popupHeight - 10);
    }
    
    if (useFixedPosition) {
      this.popup.style.position = 'fixed';
      this.popup.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - 250)) + 'px';
      this.popup.style.top = topPosition + 'px';
    } else {
      this.popup.style.position = 'absolute';
      this.popup.style.left = rect.left + 'px';
      this.popup.style.top = topPosition + 'px';
    }
    
    console.log('Autocomplete: input rect:', rect);
    console.log('Autocomplete: space below:', spaceBelow, 'space above:', spaceAbove);
    console.log('Autocomplete: using', useFixedPosition ? 'FIXED' : 'ABSOLUTE', 'positioning');
    console.log('Autocomplete: positioning popup at: left=' + this.popup.style.left + ', top=' + this.popup.style.top);
    console.log('Autocomplete: viewport height:', window.innerHeight);
    
    this.renderSuggestions();
    this.show();
  }
  
  getSuggestions(type, query) {
    const suggestions = [];
    const queryLower = query.toLowerCase();
    
    console.log('Autocomplete: getting suggestions for type:', type, 'query:', query);
    
    switch (type) {
      case 'tag':
        const tagSuggestions = this.getTagSuggestions(queryLower);
        console.log('Autocomplete: tag suggestions:', tagSuggestions);
        suggestions.push(...tagSuggestions);
        break;
      case 'project':
        const projectSuggestions = this.getProjectSuggestions(queryLower);
        console.log('Autocomplete: project suggestions:', projectSuggestions);
        suggestions.push(...projectSuggestions);
        break;
      case 'domain':
        const domainSuggestions = this.getDomainSuggestions(queryLower);
        console.log('Autocomplete: domain suggestions:', domainSuggestions);
        suggestions.push(...domainSuggestions);
        break;
    }
    
    const result = suggestions.slice(0, 10); // Limit to 10 suggestions
    console.log('Autocomplete: final suggestions:', result);
    return result;
  }
  
  getTagSuggestions(query) {
    const tags = new Set();
    
    console.log('Autocomplete: collecting tags from state.tasks:', state?.tasks?.length, 'state.projects:', state?.projects?.length);
    
    if (!state) {
      console.warn('Autocomplete: state not available');
      return [];
    }
    
    // Collect tags from tasks and projects
    [...(state.tasks || []), ...(state.projects || [])].forEach(item => {
      if (item.tags && Array.isArray(item.tags)) {
        item.tags.forEach(tag => {
          if (typeof tag === 'string' && tag.trim()) {
            tags.add(tag.trim());
          }
        });
      }
    });
    
    console.log('Autocomplete: collected tags:', Array.from(tags));
    
    // Add some default tags for testing
    const defaultTags = ['дом', 'работа', 'покупки', 'здоровье', 'спорт', 'учеба', 'хобби'];
    defaultTags.forEach(tag => tags.add(tag));
    
    const filtered = Array.from(tags)
      .filter(tag => tag.toLowerCase().includes(query))
      .sort();
    
    console.log('Autocomplete: filtered tags for query "' + query + '":', filtered);
    
    return filtered.map(tag => ({
      label: tag,
      value: tag,
      type: 'tag',
      icon: '#'
    }));
  }
  
  getProjectSuggestions(query) {
    if (!state) {
      console.warn('Autocomplete: state not available for projects');
      return [];
    }
    
    return (state.projects || [])
      .filter(project => 
        project.title && 
        project.title.toLowerCase().includes(query)
      )
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(project => ({
        label: project.title,
        value: project.title,
        type: 'project',
        icon: '@',
        meta: this.getProjectMeta(project)
      }));
  }
  
  getDomainSuggestions(query) {
    if (!state) {
      console.warn('Autocomplete: state not available for domains');
      return [];
    }
    
    return (state.domains || [])
      .filter(domain => 
        domain.title && 
        domain.title.toLowerCase().includes(query)
      )
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(domain => ({
        label: domain.title,
        value: domain.title,
        type: 'domain',
        icon: '##',
        meta: this.getDomainMeta(domain)
      }));
  }
  
  getProjectMeta(project) {
    if (!state) return '0 задач';
    const taskCount = (state.tasks || []).filter(task => task.projectId === project.id).length;
    return `${taskCount} задач`;
  }
  
  getDomainMeta(domain) {
    if (!state) return '0 проектов, 0 задач';
    const projectCount = (state.projects || []).filter(project => project.domainId === domain.id).length;
    const taskCount = (state.tasks || []).filter(task => task.domainId === domain.id).length;
    return `${projectCount} проектов, ${taskCount} задач`;
  }
  
  renderSuggestions() {
    this.popup.innerHTML = '';
    
    this.items.forEach((item, index) => {
      const element = document.createElement('div');
      element.className = 'autocomplete-item';
      element.dataset.index = index;
      
      if (index === this.selectedIndex) {
        element.classList.add('selected');
      }
      
      element.innerHTML = `
        <span class="autocomplete-icon">${item.icon}</span>
        <span class="autocomplete-label">${this.highlight(item.label, this.lastTrigger.query)}</span>
        ${item.meta ? `<span class="autocomplete-meta">${item.meta}</span>` : ''}
      `;
      
      element.addEventListener('click', () => {
        this.selectedIndex = index;
        this.selectCurrent();
      });
      
      this.popup.appendChild(element);
    });
  }
  
  highlight(text, query) {
    if (!query) return text;
    
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }
  
  selectNext() {
    if (this.selectedIndex < this.items.length - 1) {
      this.selectedIndex++;
      this.updateSelection();
    }
  }
  
  selectPrevious() {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.updateSelection();
    }
  }
  
  updateSelection() {
    const items = this.popup.querySelectorAll('.autocomplete-item');
    items.forEach((item, index) => {
      item.classList.toggle('selected', index === this.selectedIndex);
    });
  }
  
  selectCurrent() {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.items.length) {
      const selectedItem = this.items[this.selectedIndex];
      this.insertSuggestion(selectedItem);
    }
  }
  
  insertSuggestion(item) {
    if (!this.lastTrigger || !this.input) return;
    
    const beforeTrigger = this.input.value.substring(0, this.lastTrigger.start);
    const afterCursor = this.input.value.substring(this.lastTrigger.end);
    
    this.input.value = beforeTrigger + item.icon + item.value + ' ' + afterCursor;
    
    // Set cursor position after inserted text
    const newCursorPos = beforeTrigger.length + item.icon.length + item.value.length + 1;
    this.input.setSelectionRange(newCursorPos, newCursorPos);
    
    this.hide();
    this.input.focus();
  }
  
  show() {
    console.log('Autocomplete: showing popup');
    
    // Force styles to ensure visibility
    this.popup.style.display = 'block';
    this.popup.style.opacity = '1';
    this.popup.style.visibility = 'visible';
    this.popup.style.background = 'var(--panel-1)';
    this.popup.style.border = '2px solid var(--panel-2)';
    this.popup.style.boxShadow = '0 6px 20px rgba(0,0,0,0.7)';
    this.popup.style.backdropFilter = 'blur(10px)';
    
    this.dim.style.display = 'block';
    this.isVisible = true;
    
    console.log('Autocomplete: popup display:', this.popup.style.display, 'isVisible:', this.isVisible);
    console.log('Autocomplete: popup computed style:', window.getComputedStyle(this.popup).display);
    console.log('Autocomplete: popup position:', this.popup.style.position, 'left:', this.popup.style.left, 'top:', this.popup.style.top);
    console.log('Autocomplete: popup z-index:', window.getComputedStyle(this.popup).zIndex);
    console.log('Autocomplete: popup visibility:', window.getComputedStyle(this.popup).visibility);
    console.log('Autocomplete: popup opacity:', window.getComputedStyle(this.popup).opacity);
    console.log('Autocomplete: popup background:', window.getComputedStyle(this.popup).backgroundColor);
  }
  
  hide() {
    this.popup.style.display = 'none';
    this.dim.style.display = 'none';
    this.isVisible = false;
    this.items = [];
    this.selectedIndex = -1;
    this.lastTrigger = null;
  }
}

// Initialize autocomplete when DOM is ready
export function initAutocomplete() {
  // Prevent multiple initialization
  if (window.autocompleteInstance) {
    console.log('Autocomplete already initialized, skipping...');
    return;
  }
  
  console.log('initAutocomplete called, readyState:', document.readyState);
  console.log('State available:', !!state, 'Tasks:', state?.tasks?.length, 'Projects:', state?.projects?.length);
  
  // Wait a bit for state to be fully loaded
  setTimeout(() => {
    // Double-check after timeout
    if (window.autocompleteInstance) {
      console.log('Autocomplete already initialized during timeout, skipping...');
      return;
    }
    
    console.log('Delayed init - State available:', !!state, 'Tasks:', state?.tasks?.length, 'Projects:', state?.projects?.length);
    
    if (document.readyState === 'loading') {
      console.log('DOM still loading, waiting for DOMContentLoaded');
      document.addEventListener('DOMContentLoaded', () => {
        if (window.autocompleteInstance) {
          console.log('Autocomplete already initialized on DOMContentLoaded, skipping...');
          return;
        }
        console.log('DOMContentLoaded fired, initializing autocomplete');
        window.autocompleteInstance = new AutocompleteSystem();
      });
    } else {
      console.log('DOM already ready, initializing autocomplete immediately');
      window.autocompleteInstance = new AutocompleteSystem();
    }
  }, 100);
}

// Export for global access
window.initAutocomplete = initAutocomplete;

// Test function to force show autocomplete
window.testAutocomplete = function() {
  console.log('Testing autocomplete...');
  const input = document.getElementById('quickAdd');
  if (input) {
    input.value = '#';
    input.focus();
    input.dispatchEvent(new Event('input'));
    console.log('Test input event dispatched');
  } else {
    console.error('quickAdd input not found');
  }
};

// Test function to force show popup in center of screen
window.testPopup = function() {
  console.log('Testing popup visibility...');
  const autocomplete = window.autocompleteInstance;
  if (autocomplete) {
    // Force position in center of screen
    autocomplete.popup.style.left = '50%';
    autocomplete.popup.style.top = '50%';
    autocomplete.popup.style.transform = 'translate(-50%, -50%)';
    autocomplete.popup.style.position = 'fixed';
    autocomplete.popup.style.display = 'block';
    autocomplete.popup.innerHTML = '<div class="autocomplete-item">Test item 1</div><div class="autocomplete-item">Test item 2</div>';
    console.log('Test popup should be visible in center of screen');
  } else {
    console.error('Autocomplete instance not found');
  }
};

// Force refresh styles function
window.forceRefreshStyles = function() {
  console.log('Forcing style refresh...');
  const autocomplete = window.autocompleteInstance;
  if (autocomplete) {
    // Force reapply all styles
    autocomplete.popup.style.cssText = `
      position: absolute;
      background: var(--panel-1) !important;
      border: 2px solid var(--panel-2) !important;
      border-radius: 6px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.7) !important;
      z-index: 1000;
      max-height: 200px;
      overflow-y: auto;
      display: none;
      min-width: 250px;
      opacity: 1 !important;
      visibility: visible !important;
      backdrop-filter: blur(10px);
    `;
    console.log('Styles refreshed');
  } else {
    console.error('Autocomplete instance not found');
  }
};

