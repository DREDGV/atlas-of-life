// js/storageAdapter.js
// Thin storage adapter for localStorage (default)

const KEY = 'atlas_v2_data';

const localStorageAdapter = {
  load(){
    try{ return localStorage.getItem(KEY); }catch(_){ return null }
  },
  save(text){
    try{ localStorage.setItem(KEY, text); }catch(_){ /* ignore */ }
  },
  clear(){
    try{ localStorage.removeItem(KEY); }catch(_){ /* ignore */ }
  },
  key: KEY,
};

export default localStorageAdapter;

