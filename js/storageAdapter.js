// js/storageAdapter.js
// Thin storage adapter for localStorage (default)

const KEY = 'atlas_v2_data';

const localStorageAdapter = {
  load(){
    try{ return localStorage.getItem(KEY); }catch(_){ return null }
  },
  save(text){
    try{ 
      localStorage.setItem(KEY, text); 
    }catch(e){ 
      // Handle localStorage errors (e.g. quota exceeded)
      console.warn('Failed to save to localStorage:', e);
      // Optionally notify the user about the storage issue
      if (typeof window !== 'undefined' && window.showToast) {
        window.showToast('Ошибка сохранения данных: недостаточно места', 'warn');
      }
    }
  },
  clear(){
    try{ localStorage.removeItem(KEY); }catch(_){ /* ignore */ }
  },
  key: KEY,
};

export default localStorageAdapter;