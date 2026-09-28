import { createContext } from 'react';
import type { DatabaseData } from '../types';

/** Pre-loaded database payloads for inline databases on a published page. */
export const PublicDataContext = createContext<Record<string, DatabaseData>>({});
