/// <reference types="vite/client" />
import type { MCodeAPI } from '@shared/types';

declare global {
  interface Window {
    mcode: MCodeAPI;
  }
}
