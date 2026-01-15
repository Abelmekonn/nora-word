/// <reference types="office-js" />

// Extend Window interface to include Office globals
declare global {
  interface Window {
    Office: typeof Office;
    Word: typeof Word;
  }
}

export {};
