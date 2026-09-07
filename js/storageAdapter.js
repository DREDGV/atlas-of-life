// js/storageAdapter.js
// Thin storage adapter for localStorage (default)

const KEY = 'atlas_v2_data';

const localStorageAdapter = {
  load(){
    return localStorage.getItem(KEY);
  },
  save(text){
    localStorage.setItem(KEY, text);
    return true;
  },
  clear(){
    try{ localStorage.removeItem(KEY); }catch(_){ /* ignore */ }
  },
  key: KEY,
};

export default localStorageAdapter;
